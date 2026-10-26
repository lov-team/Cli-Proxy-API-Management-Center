import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { authFilesApi, type AuthDiagnosticResult } from '@/services/api/authFiles';
import { useAuthStore } from '@/stores';
import styles from './AuthFileDiagnostics.module.scss';

type Props = { name: string; authIndex?: string; disabled: boolean; dirty: boolean };
type Outcome = { result?: AuthDiagnosticResult; error?: string };

export function AuthFileDiagnostics(props: Props) {
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  // Remount state on account/connection changes; credentials never reach the DOM.
  return (
    <DiagnosticSession
      key={`${apiBase}:${managementKey}:${props.name}:${props.authIndex ?? ''}:${props.dirty}`}
      {...props}
    />
  );
}

function DiagnosticSession({ name, authIndex, disabled, dirty }: Props) {
  const { t } = useTranslation();
  const [models, setModels] = useState<{ value: string; label: string }[]>([]);
  const [model, setModel] = useState('');
  const [modelError, setModelError] = useState('');
  const [modelsLoading, setModelsLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [running, setRunning] = useState<'proxy' | 'model' | null>(null);
  const [proxyOutcome, setProxyOutcome] = useState<Outcome>();
  const [modelOutcome, setModelOutcome] = useState<Outcome>();
  const active = useRef<AbortController | null>(null);
  const blocked = disabled || dirty;

  useEffect(() => {
    const controller = new AbortController();
    authFilesApi
      .getModelsForAuthFile(name, authIndex, controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return;
        const options = items
          .filter((item) => item.test_supported !== false)
          .map((item) => ({
            value: item.id,
            label: item.display_name ? `${item.id} (${item.display_name})` : item.id,
          }));
        setModels(options);
        setModel(options[0]?.value ?? '');
        setModelError('');
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setModelError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setModelsLoading(false);
      });
    return () => controller.abort();
  }, [name, authIndex, reload]);

  useEffect(() => () => active.current?.abort(), []);

  const run = async (kind: 'proxy' | 'model') => {
    if (blocked || active.current || (kind === 'model' && !model)) return;
    const controller = new AbortController();
    active.current = controller;
    setRunning(kind);
    const setOutcome = kind === 'proxy' ? setProxyOutcome : setModelOutcome;
    setOutcome(undefined);
    try {
      const lookup = { name, authIndex };
      const result =
        kind === 'proxy'
          ? await authFilesApi.testProxy(lookup, controller.signal)
          : await authFilesApi.testModel(lookup, model, controller.signal);
      if (!controller.signal.aborted) setOutcome({ result });
    } catch (error: unknown) {
      if (!controller.signal.aborted)
        setOutcome({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (active.current === controller) {
        active.current = null;
        setRunning(null);
      }
    }
  };

  const renderOutcome = (outcome?: Outcome) => {
    if (!outcome) return null;
    const result = outcome.result;
    return (
      <div role="status" className={styles.result} data-success={result?.success ?? false}>
        <strong>
          {outcome.error
            ? t('auth_files.diagnostics.failed')
            : result?.skipped
              ? t('auth_files.diagnostics.skipped')
              : result?.success
                ? t('auth_files.diagnostics.success')
                : t('auth_files.diagnostics.failed')}
        </strong>
        {result && (
          <span>
            {t('auth_files.diagnostics.elapsed', { seconds: result.time.toFixed(2) })}
            {result.status_code ? ` · HTTP ${result.status_code}` : ''}
          </span>
        )}
        <span>{outcome.error ?? result?.message}</span>
        {result?.proxy_source && (
          <span>{t(`auth_files.diagnostics.source_${result.proxy_source}`)}</span>
        )}
        {result?.target && <span>{result.target}</span>}
        {result?.model && <span>{result.model}</span>}
      </div>
    );
  };

  return (
    <section className={styles.panel} aria-label={t('auth_files.diagnostics.title')}>
      <h3>{t('auth_files.diagnostics.title')}</h3>
      <p>{t(dirty ? 'auth_files.diagnostics.save_first' : 'auth_files.diagnostics.saved_hint')}</p>
      <div className={styles.group}>
        <Button
          variant="secondary"
          disabled={blocked || running !== null}
          loading={running === 'proxy'}
          onClick={() => void run('proxy')}
        >
          {t('auth_files.diagnostics.proxy')}
        </Button>
        <p>{t('auth_files.diagnostics.proxy_hint')}</p>
        {renderOutcome(proxyOutcome)}
      </div>
      <div className={styles.group}>
        <label id="diagnostic-model-label">{t('auth_files.diagnostics.model')}</label>
        <Select
          ariaLabelledBy="diagnostic-model-label"
          value={model}
          options={models}
          onChange={(value) => {
            setModel(value);
            setModelOutcome(undefined);
          }}
          disabled={blocked || running !== null || modelsLoading}
          placeholder={t(
            modelsLoading
              ? 'auth_files.diagnostics.loading_models'
              : 'auth_files.diagnostics.no_models'
          )}
        />
        {modelError && (
          <div role="alert">
            {modelError}
            <Button
              variant="secondary"
              onClick={() => {
                setModelsLoading(true);
                setReload((value) => value + 1);
              }}
            >
              {t('auth_files.diagnostics.retry')}
            </Button>
          </div>
        )}
        <p>{t('auth_files.diagnostics.model_hint')}</p>
        <Button
          variant="secondary"
          disabled={blocked || running !== null || modelsLoading || !model}
          loading={running === 'model'}
          onClick={() => void run('model')}
        >
          {t('auth_files.diagnostics.test_model')}
        </Button>
        {renderOutcome(modelOutcome)}
      </div>
      {running && (
        <Button
          variant="secondary"
          onClick={() => {
            active.current?.abort();
          }}
        >
          {t('auth_files.diagnostics.cancel')}
        </Button>
      )}
    </section>
  );
}
