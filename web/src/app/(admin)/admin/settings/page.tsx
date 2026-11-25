'use client';

import { useEffect, useState } from 'react';
import { doc } from 'firebase/firestore';
import { DEFAULT_ARCHIVE_AFTER_DAYS, DEFAULT_RETENTION_MONTHS, DEFAULT_SCREENSHOT_RETENTION_DAYS, type PlatformSettings } from '@yivents/shared';
import { Button, Card, ErrorBanner, Field, LoadingState, Modal, WarningBanner } from '@yivents/ui';
import { db } from '@/lib/firebase/client';
import { ADMIN_ACTIONS, adminAction } from '@/components/admin/adminActions';
import { friendlyError, useDocument } from '@/components/admin/adminData';
import { AdminOnly } from '@/components/admin/AdminShell';

const DEFAULTS: PlatformSettings = {
  currency: 'GHS',
  planLimits: { programs: 10, responses: 500, uploadsMb: 20, sponsorsMax: 10, slidesMax: 8 },
  archiveAfterDays: DEFAULT_ARCHIVE_AFTER_DAYS,
  retentionMonths: DEFAULT_RETENTION_MONTHS,
  screenshotRetentionDays: DEFAULT_SCREENSHOT_RETENTION_DAYS,
  almostFullThreshold: 0.1,
  featureSwitches: {},
  maintenanceMode: false,
  legalVersions: { terms: 'v1', privacy: 'v1', registrantNotice: 'v1' },
  supportEmail: '',
  domain: '',
};

function Settings() {
  const { data, loading, error } = useDocument<PlatformSettings>(() => doc(db, 'settings', 'platform'), []);
  const [settings, setSettings] = useState<PlatformSettings>(DEFAULTS);
  const [newSwitch, setNewSwitch] = useState('');
  const [confirmMaintenance, setConfirmMaintenance] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');

  useEffect(() => {
    if (!data) return;
    setSettings({
      ...DEFAULTS,
      ...data,
      planLimits: { ...DEFAULTS.planLimits, ...(data.planLimits ?? {}) },
      featureSwitches: { ...(data.featureSwitches ?? {}) },
      legalVersions: { ...DEFAULTS.legalVersions, ...(data.legalVersions ?? {}) },
    });
  }, [data?.id]);

  function number(key: keyof PlatformSettings['planLimits'], value: string) {
    const parsed = Number(value);
    setSettings((prev) => ({ ...prev, planLimits: { ...prev.planLimits, [key]: Number.isFinite(parsed) ? parsed : 0 } }));
  }

  async function save(maintenance = settings.maintenanceMode) {
    setBusy(true);
    setFailure('');
    setNotice('');
    try {
      const next = { ...settings, maintenanceMode: maintenance };
      await adminAction({ action: ADMIN_ACTIONS.updateSettings, payload: { ...next } });
      setSettings(next);
      setConfirmMaintenance(false);
      setNotice('Settings saved. The server applies limits and feature switches on every write.');
    } catch (err) {
      setFailure(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="yv-stack">
      <div>
        <h1>Platform settings</h1>
        <p className="yv-muted">Plan and upload limits, archiving and retention, feature switches and maintenance mode. Defaults are used until a settings document exists.</p>
      </div>

      {error ? <ErrorBanner message={error} /> : null}
      {notice ? <Card><p>{notice}</p></Card> : null}
      {failure ? <ErrorBanner message={failure} onDismiss={() => setFailure('')} /> : null}
      {loading ? <LoadingState label="Loading settings…" /> : null}

      <Card className="yv-stack">
        <h2 style={{ fontSize: '1.15rem' }}>Plan limits</h2>
        <div className="grid">
          {([
            ['programs', 'Programmes per organiser'],
            ['responses', 'Responses per organiser'],
            ['uploadsMb', 'Upload allowance (MB)'],
            ['sponsorsMax', 'Sponsors per event'],
            ['slidesMax', 'Slides per event'],
          ] as Array<[keyof PlatformSettings['planLimits'], string]>).map(([key, label]) => (
            <Field key={key} id={`limit-${key}`} label={label}>
              <input id={`limit-${key}`} type="number" min={0} value={settings.planLimits[key]} onChange={(e) => number(key, e.target.value)} />
            </Field>
          ))}
        </div>
      </Card>

      <Card className="yv-stack">
        <h2 style={{ fontSize: '1.15rem' }}>Archiving, retention and uploads</h2>
        <div className="grid">
          <Field id="archive-days" label="Archive after (days)" hint="Default 14; section 4.12 of the organiser terms">
            <input id="archive-days" type="number" min={0} value={settings.archiveAfterDays} onChange={(e) => setSettings((prev) => ({ ...prev, archiveAfterDays: Number(e.target.value) }))} />
          </Field>
          <Field id="retention-months" label="Retention (months)" hint="Default 12">
            <input id="retention-months" type="number" min={0} value={settings.retentionMonths} onChange={(e) => setSettings((prev) => ({ ...prev, retentionMonths: Number(e.target.value) }))} />
          </Field>
          <Field id="screenshot-days" label="Payment screenshot retention (days)">
            <input id="screenshot-days" type="number" min={0} value={settings.screenshotRetentionDays} onChange={(e) => setSettings((prev) => ({ ...prev, screenshotRetentionDays: Number(e.target.value) }))} />
          </Field>
          <Field id="almost-full" label="Almost-full threshold" hint="0.1 means the last 10%">
            <input id="almost-full" type="number" min={0} max={1} step={0.01} value={settings.almostFullThreshold} onChange={(e) => setSettings((prev) => ({ ...prev, almostFullThreshold: Number(e.target.value) }))} />
          </Field>
        </div>
      </Card>

      <Card className="yv-stack">
        <h2 style={{ fontSize: '1.15rem' }}>Feature switches</h2>
        {Object.entries(settings.featureSwitches).map(([key, enabled]) => (
          <div className="yv-row" key={key}>
            <input id={`switch-${key}`} type="checkbox" checked={Boolean(enabled)} onChange={(e) => setSettings((prev) => ({ ...prev, featureSwitches: { ...prev.featureSwitches, [key]: e.target.checked } }))} />
            <label htmlFor={`switch-${key}`} style={{ margin: 0 }}>{key}</label>
          </div>
        ))}
        <div className="yv-row">
          <input aria-label="New feature switch name" value={newSwitch} onChange={(e) => setNewSwitch(e.target.value)} placeholder="switch name" />
          <Button variant="outline" disabled={!newSwitch.trim() || Object.prototype.hasOwnProperty.call(settings.featureSwitches, newSwitch.trim())} onClick={() => {
            setSettings((prev) => ({ ...prev, featureSwitches: { ...prev.featureSwitches, [newSwitch.trim()]: true } }));
            setNewSwitch('');
          }}>Add switch</Button>
        </div>
      </Card>

      <Card className="yv-stack">
        <h2 style={{ fontSize: '1.15rem' }}>Maintenance mode</h2>
        {settings.maintenanceMode ? <WarningBanner>Maintenance mode is ON. Public registration and check-in are expected to be paused by the server.</WarningBanner> : null}
        <div className="yv-row">
          <input id="maintenance-toggle" type="checkbox" checked={settings.maintenanceMode} onChange={(e) => {
            if (e.target.checked) setConfirmMaintenance(true);
            else setSettings((prev) => ({ ...prev, maintenanceMode: false }));
          }} />
          <label htmlFor="maintenance-toggle" style={{ margin: 0 }}>Enable maintenance mode</label>
        </div>
      </Card>

      <div className="yv-row">
        <Button loading={busy} onClick={() => save()}>Save settings</Button>
      </div>

      <Modal open={confirmMaintenance} title="Turn on maintenance mode?" onClose={() => setConfirmMaintenance(false)}>
        <div className="yv-stack">
          <p>This is an audited admin action. Confirm that registrations and scanning should be paused.</p>
          <div className="yv-row">
            <Button variant="danger" loading={busy} onClick={() => save(true)}>Confirm and save</Button>
            <Button variant="ghost" onClick={() => setConfirmMaintenance(false)}>Cancel</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default function AdminSettingsPage() {
  return (
    <AdminOnly allow={['superAdmin']}>
      <Settings />
    </AdminOnly>
  );
}
