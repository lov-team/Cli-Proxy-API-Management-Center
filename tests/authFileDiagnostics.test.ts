import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import i18n from '../src/i18n';
import { AuthFileDiagnostics } from '../src/features/authFiles/components/AuthFileDiagnostics';
import { apiClient } from '../src/services/api/client';
import { authFilesApi } from '../src/services/api/authFiles';

const spies: { mockRestore: () => void }[] = [];
afterEach(() => { spies.splice(0).forEach((spy) => spy.mockRestore()); });

describe('account diagnostics API', () => {
  test('proxy and model tests pin the exact account and propagate cancellation', async () => {
    const result = { success: true, message: 'OK', time: 0.1 };
    const post = spyOn(apiClient, 'post').mockResolvedValue(result);
    spies.push(post);
    const controller = new AbortController();
    const lookup = { name: 'account+one.json', authIndex: 'exact-index' };
    expect(await authFilesApi.testProxy(lookup, controller.signal)).toEqual(result);
    expect(post).toHaveBeenLastCalledWith('/auth-files/proxy-test', {
      name: lookup.name, auth_index: lookup.authIndex,
    }, { signal: controller.signal, timeout: 0 });
    await authFilesApi.testModel(lookup, 'provider/model', controller.signal);
    expect(post).toHaveBeenLastCalledWith('/auth-files/model-test', {
      name: lookup.name, auth_index: lookup.authIndex, model: 'provider/model',
    }, { signal: controller.signal, timeout: 0 });
  });

  test('model catalog sends the exact account index and preserves test capability', async () => {
    const models = [{ id: 'text', test_supported: true }, { id: 'video', test_supported: false }];
    const get = spyOn(apiClient, 'get').mockResolvedValue({ models });
    spies.push(get);
    const signal = new AbortController().signal;
    expect(await authFilesApi.getModelsForAuthFile('a+b.json', 'index/value', signal)).toEqual(models);
    expect(get).toHaveBeenCalledWith('/auth-files/models?name=a%2Bb.json&auth_index=index%2Fvalue', { signal });
  });

  test('a missing backend endpoint is reported without alternate account requests', async () => {
    const post = spyOn(apiClient, 'post').mockRejectedValue(new Error('Not Found'));
    spies.push(post);
    await expect(authFilesApi.testModel({ name: 'account.json' }, 'model')).rejects.toThrow('Not Found');
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe('account diagnostics UI', () => {
  test('renders both actions with a saved-configuration and billable-use explanation', async () => {
    await i18n.changeLanguage('zh-CN');
    const markup = renderToStaticMarkup(createElement(AuthFileDiagnostics, { name: 'fixture.json', disabled: false, dirty: false }));
    expect(markup).toContain('代理检测');
    expect(markup).toContain('测试模型连接');
    expect(markup).toContain('可能消耗额度');
    expect(markup).toContain('已保存的配置');
    expect(markup).not.toContain('diagnostics.title');
  });

  test('unsaved changes disable testing and explain how to proceed', () => {
    const markup = renderToStaticMarkup(createElement(AuthFileDiagnostics, { name: 'fixture.json', disabled: false, dirty: true }));
    expect(markup).toContain('请先保存修改');
    expect(markup.match(/<button[^>]*disabled/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
