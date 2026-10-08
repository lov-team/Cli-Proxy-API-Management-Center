import { useCallback, useMemo, type MouseEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { Collapsible } from '@/components/ui/Collapsible';
import { useNotificationStore } from '@/stores';
import type {
  PrefixProxyEditorField,
  PrefixProxyEditorFieldValue,
  PrefixProxyEditorState,
} from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor';
import {
  supportsAuthFileUsingApi,
  supportsAuthFileWebsockets,
} from '@/features/authFiles/constants';
import { MAX_CREDENTIAL_WEIGHT } from '@/utils/credentialWeight';
import { AuthFileExcludedModelsField } from './AuthFileExcludedModelsField';
import { AuthFilePolicyFields } from './AuthFilePolicyFields';
import { credentialPolicyError, readCredentialPolicy } from '../credentialPolicy';
import styles from './AuthFileDetailsSheet.module.scss';

/** API 边界归一化补写的派生字段——INFO 视图里只展示后端原始形状，避免重复噪音。 */
const DERIVED_INFO_KEYS = [
  'successCount',
  'failureCount',
  'recentRequests',
  'runtimeOnly',
  'authIndex',
  'statusMessage',
  'modified',
  // 'email' 不在此列：后端原始键名与 camelCase 同形，删掉会藏起真实数据。
  'projectId',
];

export type AuthFileDetailsSheetProps = {
  disableControls: boolean;
  editor: PrefixProxyEditorState | null;
  updatedText: string;
  dirty: boolean;
  onClose: () => void;
  onCopyText: (text: string) => void | Promise<void>;
  onSave: () => void;
  onChange: (field: PrefixProxyEditorField, value: PrefixProxyEditorFieldValue) => void;
};

function Section({
  index,
  title,
  description,
  children,
}: {
  index: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <span className={styles.sectionIndex}>{index}</span>
        <div className={styles.sectionHeading}>
          <h3 className={styles.sectionTitle}>{title}</h3>
          <p className={styles.sectionDesc}>{description}</p>
        </div>
      </header>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

function SwitchField({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className={styles.switchRow}>
      <div className={styles.switchCopy}>
        <div className={styles.switchTitle}>{label}</div>
        <div className={styles.switchHint}>{hint}</div>
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} disabled={disabled} ariaLabel={label} />
    </div>
  );
}

/**
 * 凭证详情/编辑抽屉：替代旧的居中 Modal，与提供商工作台的 Sheet 模式一致。
 * 脏状态下关闭（Escape/遮罩/×/取消）先走确认对话框。
 */
export function AuthFileDetailsSheet(props: AuthFileDetailsSheetProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { disableControls, editor, updatedText, dirty, onClose, onCopyText, onSave, onChange } =
    props;
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);

  const confirmClose = useCallback((): boolean | Promise<boolean> => {
    if (!dirty || editor?.saving === true) return true;
    return new Promise<boolean>((resolve) => {
      showConfirmation({
        title: t('providersPage.unsavedChanges.title'),
        message: t('providersPage.unsavedChanges.message'),
        variant: 'danger',
        confirmText: t('providersPage.unsavedChanges.discard'),
        cancelText: t('providersPage.unsavedChanges.keepEditing'),
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }, [dirty, editor?.saving, showConfirmation, t]);

  const handleCancelClick = useCallback(() => {
    void Promise.resolve(confirmClose()).then((ok) => {
      if (ok) onClose();
    });
  }, [confirmClose, onClose]);

  const handleSettingsLinkClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      if (editor?.saving) return;

      void Promise.resolve(confirmClose()).then((ok) => {
        if (ok) void navigate('/config?field=routingStrategy');
      });
    },
    [confirmClose, editor?.saving, navigate]
  );

  const formatJsonText = (text: string) => {
    if (!text) return '';
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  };
  const previewText = formatJsonText(updatedText);
  const invalidContentPreview = editor?.invalidContentPreview ?? '';
  const fileInfoText = editor?.fileInfoText ?? '';
  const displayInfoText = useMemo(() => {
    if (!fileInfoText) return '';
    try {
      const parsed = JSON.parse(fileInfoText) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        DERIVED_INFO_KEYS.forEach((key) => {
          delete record[key];
        });
        return JSON.stringify(record, null, 2);
      }
    } catch {
      /* 非 JSON 原样展示 */
    }
    return fileInfoText;
  }, [fileInfoText]);

  let nextSection = 0;
  const nextIndex = () => String(++nextSection).padStart(2, '0');

  return (
    <Sheet
      open={Boolean(editor)}
      onClose={onClose}
      confirmClose={confirmClose}
      size="xl"
      closeDisabled={editor?.saving === true}
      eyebrow={t('auth_files.prefix_proxy_button')}
      title={editor?.fileName ?? ''}
      description={editor?.json ? t('auth_files.details_intro') : undefined}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={handleCancelClick}
            disabled={editor?.saving === true}
          >
            {dirty ? t('common.cancel') : t('common.close')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              if (!updatedText) return;
              void onCopyText(updatedText);
            }}
            disabled={editor?.saving === true || !updatedText}
          >
            {t('common.copy')}
          </Button>
          <Button
            onClick={onSave}
            loading={editor?.saving === true}
            disabled={
              disableControls ||
              editor?.saving === true ||
              !dirty ||
              !editor?.json ||
              Boolean(editor?.headersTouched && editor.headersError) ||
              Boolean(editor?.weightError) ||
              Boolean(credentialPolicyError(editor?.policy))
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      {editor && (
        <div className={styles.editor}>
          {editor.loading ? (
            <div className={styles.loading}>
              <LoadingSpinner size={14} />
              <span>{t('auth_files.prefix_proxy_loading')}</span>
            </div>
          ) : (
            <>
              {editor.error && <div className={styles.error}>{editor.error}</div>}
              {editor.json ? (
                <AuthFileEditorSections
                  editor={editor}
                  locked={disableControls || editor.saving || !editor.json}
                  nextIndex={nextIndex}
                  onChange={onChange}
                  onSettingsLinkClick={handleSettingsLinkClick}
                />
              ) : null}
              <Collapsible
                label={t('auth_files.details_section_raw')}
                hint={t('auth_files.details_section_raw_hint')}
              >
                <div className={styles.rawStack}>
                  <div className={styles.jsonWrapper}>
                    <label className={styles.label}>
                      {t('auth_files.prefix_proxy_info_label')}
                    </label>
                    <textarea
                      className={styles.textarea}
                      rows={8}
                      readOnly
                      value={displayInfoText}
                    />
                  </div>
                  <div className={styles.jsonWrapper}>
                    <label className={styles.label}>
                      {editor.json
                        ? t('auth_files.prefix_proxy_source_label')
                        : t('auth_files.prefix_proxy_invalid_content_label')}
                    </label>
                    {editor.json ? (
                      <textarea
                        className={styles.textarea}
                        rows={10}
                        readOnly
                        value={previewText}
                      />
                    ) : (
                      <pre className={styles.invalidPreview}>{invalidContentPreview}</pre>
                    )}
                  </div>
                </div>
              </Collapsible>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}

function AuthFileEditorSections({
  editor,
  locked,
  nextIndex,
  onChange,
  onSettingsLinkClick,
}: {
  editor: PrefixProxyEditorState;
  locked: boolean;
  nextIndex: () => string;
  onChange: (field: PrefixProxyEditorField, value: PrefixProxyEditorFieldValue) => void;
  onSettingsLinkClick: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const { t } = useTranslation();
  const json = editor.json;
  if (!json) return null;
  const showWebsockets = supportsAuthFileWebsockets(editor.providerKey);
  const showUsingApi = supportsAuthFileUsingApi(editor.providerKey);

  return (
    <div className={styles.sections}>
      <Section
        index={nextIndex()}
        title={t('auth_files.details_section_connection')}
        description={t('auth_files.details_section_connection_desc')}
      >
        <div className={styles.fieldGrid}>
          <Input
            label={t('auth_files.prefix_label')}
            value={editor.prefix}
            disabled={locked}
            onChange={(e) => onChange('prefix', e.target.value)}
          />
          <Input
            label={t('auth_files.proxy_url_label')}
            value={editor.proxyUrl}
            placeholder={t('auth_files.proxy_url_placeholder')}
            disabled={locked}
            onChange={(e) => onChange('proxyUrl', e.target.value)}
          />
        </div>
      </Section>

      <Section
        index={nextIndex()}
        title={t('auth_files.details_section_routing')}
        description={t('auth_files.details_section_routing_desc')}
      >
        <div className={styles.fieldGrid}>
          <Input
            label={t('auth_files.priority_label')}
            value={editor.priority}
            placeholder={t('auth_files.priority_placeholder')}
            hint={t('auth_files.priority_hint')}
            disabled={locked}
            onChange={(e) => onChange('priority', e.target.value)}
          />
          <Input
            label={t('auth_files.weight_label')}
            type="number"
            step="1"
            max={MAX_CREDENTIAL_WEIGHT}
            value={editor.weight}
            placeholder="1"
            hint={
              <Trans
                i18nKey="auth_files.weight_hint"
                components={{
                  settingsLink: (
                    <Link
                      className={styles.settingsLink}
                      to="/config?field=routingStrategy"
                      onClick={onSettingsLinkClick}
                    />
                  ),
                }}
              />
            }
            error={editor.weightError ?? undefined}
            disabled={locked}
            onChange={(e) => onChange('weight', e.target.value)}
          />
        </div>
        <SwitchField
          label={t('auth_files.disable_cooling_label')}
          hint={t('auth_files.disable_cooling_hint')}
          checked={editor.disableCooling}
          disabled={locked}
          onChange={(value) => onChange('disableCooling', value)}
        />
      </Section>

      {showWebsockets || showUsingApi ? (
        <Section
          index={nextIndex()}
          title={t('auth_files.details_section_transport')}
          description={t('auth_files.details_section_transport_desc')}
        >
          {showWebsockets ? (
            <SwitchField
              label={t('auth_files.websockets_label')}
              hint={t('auth_files.websockets_hint')}
              checked={editor.websockets}
              disabled={locked}
              onChange={(value) => onChange('websockets', value)}
            />
          ) : null}
          {showUsingApi ? (
            <SwitchField
              label={t('auth_files.using_api_label')}
              hint={t('auth_files.using_api_hint')}
              checked={editor.usingApi}
              disabled={locked}
              onChange={(value) => onChange('usingApi', value)}
            />
          ) : null}
        </Section>
      ) : null}

      <Section
        index={nextIndex()}
        title={t('auth_files.details_section_models')}
        description={t('auth_files.details_section_models_desc')}
      >
        <AuthFileExcludedModelsField
          fileName={editor.fileName}
          value={editor.excludedModelsText}
          disabled={locked}
          onChange={(value) => onChange('excludedModelsText', value)}
        />
      </Section>

      <Section
        index={nextIndex()}
        title={t('auth_files.details_section_request')}
        description={t('auth_files.details_section_request_desc')}
      >
        <div className="form-group">
          <label>{t('auth_files.headers_label')}</label>
          <textarea
            className={`input ${editor.headersError ? styles.textareaInvalid : ''}`}
            value={editor.headersText}
            placeholder={t('auth_files.headers_placeholder')}
            rows={4}
            aria-invalid={Boolean(editor.headersError)}
            disabled={locked}
            onChange={(e) => onChange('headersText', e.target.value)}
          />
          {editor.headersError && <div className="error-box">{editor.headersError}</div>}
          <div className="hint">{t('auth_files.headers_hint')}</div>
        </div>
        <AuthFilePolicyFields
          draft={editor.policy ?? readCredentialPolicy(json)}
          disabled={locked}
          onChange={onChange}
        />
      </Section>

      <Section
        index={nextIndex()}
        title={t('auth_files.details_section_note')}
        description={t('auth_files.details_section_note_desc')}
      >
        <Input
          label={t('auth_files.note_label')}
          value={editor.note}
          placeholder={t('auth_files.note_placeholder')}
          hint={t('auth_files.note_hint')}
          disabled={locked}
          onChange={(e) => onChange('note', e.target.value)}
        />
      </Section>
    </div>
  );
}
