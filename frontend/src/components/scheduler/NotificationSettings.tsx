// Failure notifications: the project's channels (HTTP endpoints), the default one, and message templates

import { useCallback, useEffect, useRef, useState } from 'react'
import { Edit2, Plus, Send, Star, Trash2, X } from 'lucide-react'
import ConfirmModal from '../main/ConfirmModal'
import { ChannelFields, NotificationChannel, NotificationSettings as Settings, schedulerApi } from './api'
import HelpTip from './HelpTip'

const NOTIFICATIONS_HELP =
  'When a job run fails, a message is sent to the job\'s own channel if it has one (set in the job form), '
  + 'otherwise to the default channel. Runs that are cancelled, skipped or interrupted by a restart are not reported.'

const TEMPLATE_HELP =
  'Write {{placeholder}} anywhere in the message, URL or body; click a placeholder below to insert it. '
  + 'The rendered message is available to the URL and body as {{message}}. Values are URL-encoded in the URL '
  + 'and JSON-escaped in a JSON body, so "text": "{{message}}" is valid JSON whatever the message holds.'

// Example values for the message preview
const EXAMPLE_VALUES: Record<string, string> = {
  job_name: 'nightly build', run_id: '128', status: 'failed', command: 'build', select: 'tag:daily',
  target: 'prod', full_refresh: 'false', scheduled_for: '2026-10-13 03:00:00', run_at: '2026-10-13 03:00:02',
  duration: '4m 12s', author: 'alice', trigger: 'schedule', commit: '1a2b3c4d',
  error: 'dbt exited with code 1',
}

interface Preset {
  label: string
  method: ChannelFields['method']
  url: string
  body_format: ChannelFields['body_format']
  body_template: string
}

const PRESETS: Preset[] = [
  {
    label: 'Telegram bot',
    method: 'POST',
    url: 'https://api.telegram.org/bot<BOT_TOKEN>/sendMessage',
    body_format: 'json',
    body_template: '{"chat_id": "<CHAT_ID>", "text": "{{message}}"}',
  },
  {
    label: 'JSON webhook (POST)',
    method: 'POST',
    url: 'https://',
    body_format: 'json',
    body_template: '{"text": "{{message}}"}',
  },
  {
    label: 'GET request',
    method: 'GET',
    url: 'https://example.com/notify?text={{message}}',
    body_format: 'json',
    body_template: '',
  },
]

function render(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, name: string) => values[name] ?? match)
}

interface NotificationSettingsProps {
  projectPath: string
  onChanged: () => Promise<void>
}

function NotificationSettings({ projectPath, onChanged }: NotificationSettingsProps) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [editing, setEditing] = useState<NotificationChannel | 'new' | null>(null)
  const [deleting, setDeleting] = useState<NotificationChannel | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const next = await schedulerApi.notifications(projectPath)
      setSettings(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [projectPath])

  useEffect(() => { load() }, [load])

  const run = async (action: () => Promise<unknown>, success?: string) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await action()
      if (success) setNotice(success)
      await load()
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!settings) return error ? <div className="scheduler-error-text block">{error}</div> : null
  const channels = settings.channels

  return (
    <div className="scheduler-notifications">
      <p className="muted">
        Failure notifications are sent as simple GET or POST requests to an HTTP(S) endpoint. The first channel you
        add becomes the default. <HelpTip text={NOTIFICATIONS_HELP} />
      </p>

      <div className="scheduler-toolbar">
        <button className="scheduler-button" onClick={() => setEditing('new')}><Plus size={14} /> Add channel</button>
      </div>

      {channels.length === 0 ? (
        <div className="scheduler-hint">No channels yet: failed runs aren't reported.</div>
      ) : (
        <table className="scheduler-table compact">
          <thead>
            <tr><th>Name</th><th>Request</th><th>Headers</th><th></th></tr>
          </thead>
          <tbody>
            {channels.map(channel => (
              <tr key={channel.id}>
                <td>
                  {channel.name}
                  {channel.is_default && <span className="scheduler-default-label">default</span>}
                </td>
                <td className="mono">{channel.method} {channel.url_preview}</td>
                <td className="mono muted">{channel.header_names.join(', ') || '—'}</td>
                <td className="scheduler-actions">
                  <button
                    className="scheduler-icon-button"
                    title="Send a test notification (about the latest failed job run, if any)"
                    disabled={busy}
                    onClick={() => run(async () => {
                      const result = await schedulerApi.testChannel(projectPath, channel.id)
                      setNotice(`Test sent to ${channel.name}${result.run_id ? ` (about run #${result.run_id})` : ' (with example values)'}`)
                    })}
                  >
                    <Send size={14} />
                  </button>
                  {!channel.is_default && (
                    <button
                      className="scheduler-icon-button"
                      title="Make default"
                      disabled={busy}
                      onClick={() => run(() => schedulerApi.setDefaultChannel(projectPath, channel.id))}
                    >
                      <Star size={14} />
                    </button>
                  )}
                  <button className="scheduler-icon-button" title="Edit" onClick={() => setEditing(channel)}>
                    <Edit2 size={14} />
                  </button>
                  <button className="scheduler-icon-button" title="Delete" disabled={busy} onClick={() => setDeleting(channel)}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {notice && <div className="scheduler-hint">{notice}</div>}
      {error && <div className="scheduler-error-text block">{error}</div>}

      {editing && (
        <ChannelForm
          projectPath={projectPath}
          channel={editing === 'new' ? null : editing}
          settings={settings}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            run(async () => undefined)
          }}
        />
      )}

      {deleting && (
        <ConfirmModal
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            run(() => schedulerApi.deleteChannel(projectPath, deleting.id))
            setDeleting(null)
          }}
          title={`Delete channel "${deleting.name}"?`}
          message={'Jobs that use it will notify the default channel instead.'
            + (deleting.is_default && channels.length > 1 ? ' The oldest remaining channel becomes the default.' : '')}
          confirmLabel="Delete"
          variant="danger"
        />
      )}
    </div>
  )
}

type TemplateField = 'message_template' | 'url' | 'body_template'

interface ChannelFormProps {
  projectPath: string
  channel: NotificationChannel | null // null = new channel
  settings: Settings
  onClose: () => void
  onSaved: () => void
}

function ChannelForm({ projectPath, channel, settings, onClose, onSaved }: ChannelFormProps) {
  const [fields, setFields] = useState<ChannelFields>(() => channel ? {
    name: channel.name, method: channel.method, body_format: channel.body_format,
    body_template: channel.body_template, message_template: channel.message_template,
  } : {
    name: '', method: 'POST', body_format: 'json', body_template: PRESETS[0].body_template,
    message_template: settings.default_message_template,
  })
  const [url, setUrl] = useState(channel ? '' : PRESETS[0].url)
  // Stored headers are write-only: they are only sent when replaced
  const [replaceHeaders, setReplaceHeaders] = useState(channel === null)
  const [headers, setHeaders] = useState<{ name: string; value: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastFocused = useRef<{ field: TemplateField; el: HTMLInputElement | HTMLTextAreaElement } | null>(null)

  const set = <K extends keyof ChannelFields>(key: K, value: ChannelFields[K]) =>
    setFields(prev => ({ ...prev, [key]: value }))
  const isNew = channel === null
  const values = { ...EXAMPLE_VALUES, run_url: settings.ui_url ? `${settings.ui_url}/?scheduler_run=128` : '' }

  const applyPreset = (preset: Preset) => {
    setFields(prev => ({ ...prev, method: preset.method, body_format: preset.body_format, body_template: preset.body_template }))
    setUrl(preset.url)
  }

  const setTemplate = (field: TemplateField, value: string) => (field === 'url' ? setUrl(value) : set(field, value))

  // Insert a placeholder at the cursor of the template field last focused (the message by default)
  const insert = (name: string) => {
    const token = `{{${name}}}`
    const target = lastFocused.current
    if (!target || (name === 'message' && target.field === 'message_template')) {
      if (name !== 'message') set('message_template', fields.message_template + token)
      return
    }
    const { el, field } = target
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? start
    setTemplate(field, el.value.slice(0, start) + token + el.value.slice(end))
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + token.length, start + token.length)
    })
  }
  const track = (field: TemplateField) => ({
    onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      lastFocused.current = { field, el: e.target }
    },
  })

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    const payload = {
      ...fields,
      url,
      headers: replaceHeaders
        ? Object.fromEntries(headers.filter(h => h.name.trim()).map(h => [h.name.trim(), h.value]))
        : null,
    }
    try {
      if (isNew) await schedulerApi.createChannel(projectPath, payload)
      else await schedulerApi.updateChannel(projectPath, channel.id, payload)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const canSave = fields.name.trim() !== '' && (!isNew || url.trim() !== '') && !saving

  return (
    <div className="scheduler-modal-overlay" onMouseDown={onClose}>
      <div className="scheduler-modal" onMouseDown={e => e.stopPropagation()}>
        <div className="scheduler-modal-header">
          <h3>{isNew ? 'New notification channel' : `Edit channel: ${channel.name}`}</h3>
          <button className="scheduler-icon-button" onClick={onClose} title="Close"><X size={16} /></button>
        </div>

        <div className="scheduler-modal-content">
          <div className="scheduler-row">
            <label className="scheduler-field grow">
              <span>Name</span>
              <input value={fields.name} onChange={e => set('name', e.target.value)} placeholder="team telegram" autoFocus />
            </label>
            <label className="scheduler-field">
              <span>Start from</span>
              <select value="" onChange={e => e.target.value && applyPreset(PRESETS[Number(e.target.value)])}>
                <option value="">Choose…</option>
                {PRESETS.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
              </select>
            </label>
          </div>

          <div className="scheduler-section-title">Request</div>
          <div className="scheduler-row">
            <label className="scheduler-field">
              <span>Method</span>
              <select value={fields.method} onChange={e => set('method', e.target.value as ChannelFields['method'])}>
                <option value="POST">POST</option>
                <option value="GET">GET</option>
              </select>
            </label>
            <label className="scheduler-field grow">
              <span>URL</span>
              <input
                className="mono"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder={isNew ? 'https://…' : `Leave empty to keep ${channel.url_preview}`}
                {...track('url')}
              />
            </label>
          </div>
          {!isNew && (
            <div className="scheduler-hint">
              The URL is stored encrypted and isn't shown again; enter it in full to change it.
            </div>
          )}

          {fields.method === 'POST' && (
            <>
              <div className="scheduler-row">
                <label className="scheduler-field">
                  <span>Body format</span>
                  <select value={fields.body_format} onChange={e => set('body_format', e.target.value as ChannelFields['body_format'])}>
                    <option value="json">JSON</option>
                    <option value="text">Plain text</option>
                  </select>
                </label>
                <span className="grow" />
              </div>
              <label className="scheduler-field">
                <span>Body</span>
                <textarea
                  className="mono"
                  rows={3}
                  value={fields.body_template}
                  onChange={e => set('body_template', e.target.value)}
                  {...track('body_template')}
                />
              </label>
            </>
          )}

          <div className="scheduler-field">
            <span>Headers (optional, stored encrypted)</span>
            {!isNew && (
              <label className="scheduler-check inline">
                <input type="checkbox" checked={replaceHeaders} onChange={e => setReplaceHeaders(e.target.checked)} />
                <span>
                  Replace stored headers{' '}
                  <span className="muted">({channel.header_names.length ? channel.header_names.join(', ') : 'none'})</span>
                </span>
              </label>
            )}
            {replaceHeaders && (
              <>
                {headers.map((header, i) => (
                  <div className="scheduler-row" key={i}>
                    <input
                      className="mono"
                      placeholder="Header-Name"
                      value={header.name}
                      onChange={e => setHeaders(headers.map((h, j) => j === i ? { ...h, name: e.target.value } : h))}
                    />
                    <input
                      className="mono grow"
                      type="password"
                      placeholder="value"
                      value={header.value}
                      onChange={e => setHeaders(headers.map((h, j) => j === i ? { ...h, value: e.target.value } : h))}
                    />
                    <button className="scheduler-icon-button" onClick={() => setHeaders(headers.filter((_, j) => j !== i))}>
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <div>
                  <button className="scheduler-button" onClick={() => setHeaders([...headers, { name: '', value: '' }])}>
                    <Plus size={14} /> Add header
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="scheduler-section-title">Message <HelpTip text={TEMPLATE_HELP} /></div>
          <textarea
            className="mono"
            rows={7}
            value={fields.message_template}
            onChange={e => set('message_template', e.target.value)}
            {...track('message_template')}
          />
          <div className="scheduler-placeholders">
            {Object.entries(settings.placeholders).map(([name, description]) => (
              <button key={name} className="scheduler-placeholder" title={description} onClick={() => insert(name)}>
                {`{{${name}}}`}
              </button>
            ))}
          </div>
          <div className="scheduler-field">
            <span>Preview, with example values</span>
            <pre className="scheduler-message-preview">{render(fields.message_template, values)}</pre>
          </div>

          {error && <div className="scheduler-error-text block">{error}</div>}
        </div>

        <div className="scheduler-modal-actions">
          <button className="scheduler-button" onClick={onClose}>Cancel</button>
          <button className="scheduler-button primary" disabled={!canSave} onClick={handleSave}>
            {saving ? 'Saving…' : isNew ? 'Add channel' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default NotificationSettings
