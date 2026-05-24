import React from 'react';
import { useState, useMemo, useEffect, useCallback } from 'react';

// ─────────────────────────────────────────────
// DATA MODEL
// ─────────────────────────────────────────────

const PSP_DATA = [
  {
    id: 'gpay',
    name: 'Google Pay',
    shortName: 'GPay',
    handles: ['@okaxis', '@okicici', '@oksbi', '@okhdfcbank'],
    color: '#4285F4',
    difficulty: 'easy',
    cleanupSteps: [
      'Open Google Pay app',
      'Tap your profile photo (top right)',
      "Tap 'Bank account'",
      'Select the account linked to the UPI ID',
      "Tap 'Remove bank account'",
      'Confirm — this deletes the associated @ok* VPA',
    ],
  },
  {
    id: 'phonepe',
    name: 'PhonePe',
    shortName: 'PhonePe',
    handles: ['@ybl', '@axl', '@ibl'],
    color: '#5f259f',
    difficulty: 'easy',
    cleanupSteps: [
      'Open PhonePe app',
      'Tap the profile icon (top left)',
      "Go to 'Payment Methods' → 'UPI'",
      'Select the UPI ID you want to remove',
      "Tap 'Delete UPI ID' and confirm",
    ],
  },
  {
    id: 'paytm',
    name: 'Paytm',
    shortName: 'Paytm',
    handles: ['@paytm', '@ptyes', '@pthdfc', '@ptaxis', '@ptsbi', '@ptkotak'],
    color: '#00BAF2',
    difficulty: 'medium',
    cleanupSteps: [
      'Open Paytm app',
      'Tap the profile icon',
      "Go to 'Payment Settings' → 'UPI & Linked Bank Accounts'",
      'Tap the UPI ID to remove',
      "Select 'Remove UPI ID'",
      'Confirm with your Paytm PIN',
    ],
  },
  {
    id: 'bhim',
    name: 'BHIM',
    shortName: 'BHIM',
    handles: ['@upi'],
    color: '#138808',
    difficulty: 'medium',
    cleanupSteps: [
      'Open BHIM app',
      "Go to 'Profile' → 'UPI IDs'",
      'Select the UPI ID to remove',
      "Tap 'Remove UPI ID'",
      'Or: deregister via Settings → Deregister',
    ],
  },
  {
    id: 'amazonpay',
    name: 'Amazon Pay',
    shortName: 'Amazon Pay',
    handles: ['@apl', '@yapl'],
    color: '#FF9900',
    difficulty: 'hard',
    cleanupSteps: [
      "Open Amazon app → tap 'Pay' tab",
      "Go to 'Manage UPI IDs'",
      'Select the UPI ID',
      "Tap 'Remove' (or 'UPI Settings' if not visible)",
      'If self-service fails: contact Amazon Pay support via chat',
    ],
  },
  {
    id: 'cred',
    name: 'CRED',
    shortName: 'CRED',
    handles: ['@axisb', '@sc'],
    color: '#7B61FF',
    difficulty: 'medium',
    cleanupSteps: [
      'Open CRED app',
      "Go to Profile → 'Payment Methods'",
      "Tap 'UPI' section",
      "Select the UPI ID and tap 'Remove'",
      'Confirm with MPIN',
    ],
  },
];

const BANK_DATA = [
  {
    id: 'hdfc',
    name: 'HDFC Bank',
    handles: ['@hdfcbank', '@payzapp'],
    color: '#004C8F',
    cleanupSteps: [
      'Log in to HDFC NetBanking',
      "Go to 'Pay' → 'UPI' → 'Manage UPI IDs'",
      "Select the VPA and choose 'Deregister'",
      'Or visit branch and submit UPI Deactivation Request form',
    ],
  },
  {
    id: 'icici',
    name: 'ICICI Bank',
    handles: ['@icici', '@icicinrbin'],
    color: '#F58220',
    cleanupSteps: [
      'Open iMobile Pay app',
      "Go to Profile → 'Manage UPI IDs'",
      'Select the VPA to deactivate',
      "Tap 'Deactivate' and confirm",
    ],
  },
  {
    id: 'sbi',
    name: 'SBI',
    handles: ['@sbi', '@sbipay'],
    color: '#2980B9',
    cleanupSteps: [
      'Open YONO SBI app',
      "Go to 'UPI' → 'Manage VPA'",
      'Select the UPI ID to delete',
      'Confirm deletion with OTP',
    ],
  },
  {
    id: 'axis',
    name: 'Axis Bank',
    handles: ['@axisbank', '@axis'],
    color: '#97144D',
    cleanupSteps: [
      'Open Axis Mobile app',
      "Go to 'UPI' → 'Registered VPAs'",
      "Select the VPA and tap 'Remove'",
      'Authenticate with your UPI PIN to confirm',
    ],
  },
];

const USSD_STEPS = [
  {
    step: 'Dial *99#',
    detail:
      'Works on any mobile — smartphone or feature phone, with or without internet.',
  },
  {
    step: 'Select option 1 → Send Money',
    detail: 'Navigate with number keys. No touchscreen needed.',
  },
  {
    step: "Choose 'My Profile'",
    detail:
      'Shows linked bank accounts and all registered VPA handles for that SIM.',
  },
  {
    step: 'Note all VPAs shown',
    detail:
      'Cross-check against your audit list. This is read-only — you cannot delete from here.',
  },
  {
    step: 'Repeat for each old SIM',
    detail:
      "Insert old SIM into any handset, dial *99#, and note what's still registered.",
  },
];

const STORAGE_KEY = 'upi_audit_v3';

// ─────────────────────────────────────────────
// RISK ENGINE
// ─────────────────────────────────────────────

function scoreVPA({
  appId,
  lastUsedYear,
  phoneNumberStatus,
  bankAccountStatus,
}) {
  let score = 0;
  const flags = [];
  const yearsIdle = lastUsedYear ? new Date().getFullYear() - lastUsedYear : 3;
  if (yearsIdle >= 3) {
    score += 35;
    flags.push(`Idle ${yearsIdle}+ years`);
  } else if (yearsIdle >= 1) {
    score += 15;
    flags.push(`Idle ${yearsIdle} year(s)`);
  }
  if (phoneNumberStatus === 'changed') {
    score += 40;
    flags.push('Phone number changed/surrendered');
  } else if (phoneNumberStatus === 'inactive') {
    score += 30;
    flags.push('Phone number inactive');
  }
  if (bankAccountStatus === 'closed') {
    score += 30;
    flags.push('Bank account closed');
  } else if (bankAccountStatus === 'dormant') {
    score += 20;
    flags.push('Account dormant');
  }
  const app = PSP_DATA.find((p) => p.id === appId);
  if (app?.difficulty === 'hard') {
    score += 5;
    flags.push('Hard to remove');
  }
  score = Math.min(score, 100);
  const level = score >= 60 ? 'HIGH' : score >= 30 ? 'MEDIUM' : 'LOW';
  const color = score >= 60 ? '#FF4444' : score >= 30 ? '#FF9F1C' : '#2EC4B6';
  return { score, level, color, flags };
}

function generateVPAsForSIM({
  mobile,
  selectedApps,
  selectedBanks,
  lastUsed,
  phoneStatus,
  bankStatus,
  label,
}) {
  const vpas = [];
  const suffix = mobile.slice(-10);
  selectedApps.forEach((appId) => {
    const app = PSP_DATA.find((p) => p.id === appId);
    if (!app) return;
    app.handles.forEach((handle) => {
      vpas.push({
        vpa: `${suffix}${handle}`,
        appId,
        appName: app.name,
        handle,
        risk: scoreVPA({
          appId,
          lastUsedYear: lastUsed,
          phoneNumberStatus: phoneStatus,
          bankAccountStatus: bankStatus,
        }),
        type: 'psp',
        cleanupSteps: app.cleanupSteps,
        color: app.color,
        simLabel: label,
        mobile,
      });
    });
  });
  selectedBanks.forEach((bankId) => {
    const bank = BANK_DATA.find((b) => b.id === bankId);
    if (!bank) return;
    bank.handles.forEach((handle) => {
      vpas.push({
        vpa: `${suffix}${handle}`,
        bankId,
        appName: bank.name,
        handle,
        risk: scoreVPA({
          lastUsedYear: lastUsed,
          phoneNumberStatus: phoneStatus,
          bankAccountStatus: bankStatus,
        }),
        type: 'bank',
        cleanupSteps: bank.cleanupSteps,
        color: bank.color,
        simLabel: label,
        mobile,
      });
    });
  });
  return vpas;
}

// ─────────────────────────────────────────────
// PERSISTENCE — localStorage
// ─────────────────────────────────────────────

function saveSession(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_) {}
}

function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function clearSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (_) {}
}

// ─────────────────────────────────────────────
// URL SHARE ENCODING
// ─────────────────────────────────────────────

// We encode sims config only (not done[], which is device-specific progress).
// Mobile numbers are masked in the text summary but stored in full in the URL
// (user is sharing their own link intentionally).

function encodeStateToURL(sims) {
  try {
    const payload = JSON.stringify({ sims });
    const encoded = btoa(unescape(encodeURIComponent(payload)));
    const url = `${window.location.href.split('?')[0]}?audit=${encoded}`;
    return url;
  } catch (_) {
    return null;
  }
}

function decodeStateFromURL() {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('audit');
    if (!raw) return null;
    const decoded = decodeURIComponent(escape(atob(raw)));
    return JSON.parse(decoded);
  } catch (_) {
    return null;
  }
}

function buildTextSummary(sims, vpas, done) {
  const date = new Date().toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const mask = (m) => `XXXXXX${m.slice(-4)}`;
  const high = vpas.filter((v) => v.risk.level === 'HIGH').length;
  const med = vpas.filter((v) => v.risk.level === 'MEDIUM').length;
  const low = vpas.filter((v) => v.risk.level === 'LOW').length;

  let txt = `UPI AUDIT REPORT — ${date}\n`;
  txt += `${'─'.repeat(40)}\n`;
  txt += `SIMs audited : ${sims.length}\n`;
  txt += `Total VPAs   : ${vpas.length}  (HIGH: ${high}  MED: ${med}  LOW: ${low})\n`;
  txt += `Cleaned up   : ${done.length}/${vpas.length}\n\n`;

  sims.forEach((s, idx) => {
    const label = s.label || `SIM ${idx + 1}`;
    txt += `[ ${label} — +91 ${mask(s.mobile)} ]\n`;
    const sv = vpas
      .filter((v) => v.mobile === s.mobile)
      .sort((a, b) => b.risk.score - a.risk.score);
    sv.forEach((v) => {
      const status = done.includes(v.vpa) ? '✓ DONE  ' : '☐ TODO  ';
      txt += `  ${status}${v.vpa.padEnd(34)} ${v.risk.level} (${
        v.risk.score
      })\n`;
    });
    txt += '\n';
  });

  txt += `${'─'.repeat(40)}\n`;
  txt += `NOTE: Dial *99# on each SIM to verify remaining VPAs.\n`;
  txt += `Re-audit every 6 months.\n`;
  return txt;
}

// ─────────────────────────────────────────────
// PDF EXPORT
// ─────────────────────────────────────────────

function exportToPDF(allVPAs, sims) {
  const today = new Date().toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const rc = { HIGH: '#cc0000', MEDIUM: '#cc6600', LOW: '#006655' };
  const rows = [...allVPAs]
    .sort((a, b) => b.risk.score - a.risk.score)
    .map(
      (v) => `
    <tr><td style="font-family:monospace;font-size:11px">${v.vpa}</td><td>${
        v.appName
      }</td><td>${v.simLabel || v.mobile}</td>
    <td style="color:${rc[v.risk.level]};font-weight:700">${v.risk.level} (${
        v.risk.score
      })</td>
    <td style="font-size:10px;color:#666">${v.risk.flags.join(
      ', '
    )}</td><td style="text-align:center;font-size:15px">☐</td></tr>`
    )
    .join('');
  const apps = {};
  allVPAs.forEach((v) => {
    if (!apps[v.appName]) apps[v.appName] = v.cleanupSteps || [];
  });
  const stepBlocks = Object.entries(apps)
    .map(
      ([n, ss]) => `
    <div style="break-inside:avoid;margin-bottom:14px"><div style="font-weight:700;font-size:12px;margin-bottom:4px;border-bottom:1px solid #eee;padding-bottom:3px">${n}</div>
    <ol style="margin:0;padding-left:18px;font-size:11px;color:#333;line-height:1.6">${ss
      .map((s) => `<li>${s}</li>`)
      .join('')}</ol></div>`
    )
    .join('');
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>UPI Audit — ${today}</title>
  <style>body{font-family:'Helvetica Neue',Arial,sans-serif;color:#111;margin:0;padding:28px;font-size:12px}h1{font-size:20px;margin:0 0 3px}.sub{color:#999;font-size:10px;margin-bottom:20px}.stats{display:flex;gap:12px;margin-bottom:20px}.stat{border:1px solid #ddd;border-radius:6px;padding:10px 16px;text-align:center;min-width:80px}.stat-v{font-size:20px;font-weight:800}.stat-l{font-size:9px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-top:2px}table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:24px}th{background:#f5f5f5;text-align:left;padding:7px 9px;font-size:9px;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #ddd}td{padding:7px 9px;border-bottom:1px solid #f0f0f0;vertical-align:top}tr:nth-child(even) td{background:#fafafa}h2{font-size:14px;margin:18px 0 9px;border-top:2px solid #111;padding-top:10px}.steps-grid{columns:2;column-gap:20px}.ussd{border:1px solid #ddd;border-radius:8px;padding:14px;margin-top:18px;break-inside:avoid}.footer{margin-top:24px;border-top:1px solid #eee;padding-top:8px;font-size:9px;color:#bbb}@media print{body{padding:0}}</style></head><body>
  <h1>UPI Audit Report</h1><div class="sub">Generated ${today} · Local-only — not stored or transmitted</div>
  <div class="stats">
    <div class="stat"><div class="stat-v">${
      allVPAs.length
    }</div><div class="stat-l">Total VPAs</div></div>
    <div class="stat"><div class="stat-v" style="color:#cc0000">${
      allVPAs.filter((v) => v.risk.level === 'HIGH').length
    }</div><div class="stat-l">High Risk</div></div>
    <div class="stat"><div class="stat-v" style="color:#cc6600">${
      allVPAs.filter((v) => v.risk.level === 'MEDIUM').length
    }</div><div class="stat-l">Medium</div></div>
    <div class="stat"><div class="stat-v" style="color:#006655">${
      allVPAs.filter((v) => v.risk.level === 'LOW').length
    }</div><div class="stat-l">Low Risk</div></div>
    <div class="stat"><div class="stat-v">${
      sims.length
    }</div><div class="stat-l">SIMs</div></div>
  </div>
  <div style="font-size:10px;color:#888;margin-bottom:16px">Numbers: ${sims
    .map((s, i) => `${s.label || 'SIM ' + (i + 1)} (+91 ${s.mobile})`)
    .join(' · ')}</div>
  <h2>VPA Inventory</h2>
  <table><thead><tr><th>VPA</th><th>App/Bank</th><th>SIM</th><th>Risk</th><th>Risk Factors</th><th>Done</th></tr></thead><tbody>${rows}</tbody></table>
  <h2>Cleanup Steps by App/Bank</h2><div class="steps-grid">${stepBlocks}</div>
  <div class="ussd"><div style="font-weight:700;margin-bottom:6px">*99# USSD — Read-Only VPA Discovery</div>
  <ol style="margin:0;padding-left:18px;font-size:11px;color:#333;line-height:1.7"><li>Dial *99# on any mobile (no internet needed)</li><li>Option 1 → My Profile → note all registered VPAs</li><li>Repeat for each old SIM card</li></ol>
  <div style="font-size:10px;color:#999;margin-top:6px">⚠ Read-only. Cannot delete VPAs — use apps for that.</div></div>
  <div class="footer">UPI Audit v0.3 · Re-audit every 6 months · No data stored or transmitted</div></body></html>`;
  const win = window.open('', '_blank');
  if (win) {
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 400);
  }
}

// ─────────────────────────────────────────────
// ICS REMINDER
// ─────────────────────────────────────────────

function downloadICS() {
  const f = new Date();
  f.setMonth(f.getMonth() + 6);
  const p = (n) => String(n).padStart(2, '0');
  const fmt = (d) =>
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T090000`;
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//UPI Audit//EN',
    'BEGIN:VEVENT',
    `DTSTART:${fmt(f)}`,
    `DTEND:${fmt(f)}`,
    'SUMMARY:UPI Audit — Review & Clean Up Old VPAs',
    'DESCRIPTION:Time to re-audit your UPI IDs. Check for orphaned VPAs. Dial *99# on each SIM.',
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    'DESCRIPTION:UPI Audit Reminder',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(
      new Blob([ics], { type: 'text/calendar;charset=utf-8' })
    ),
    download: 'upi-audit-reminder.ics',
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─────────────────────────────────────────────
// SHARED PRIMITIVES
// ─────────────────────────────────────────────

const ls = {
  display: 'block',
  fontSize: 10,
  fontWeight: 700,
  color: '#555',
  letterSpacing: 0.8,
  marginBottom: 5,
  textTransform: 'uppercase',
};
const is = {
  display: 'block',
  width: '100%',
  background: '#111',
  border: '1px solid #252525',
  borderRadius: 8,
  padding: '9px 11px',
  color: '#ddd',
  fontSize: 12,
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};
const bp = {
  width: '100%',
  padding: '11px',
  borderRadius: 10,
  fontSize: 12,
  fontWeight: 800,
  border: 'none',
  cursor: 'pointer',
  background: '#2EC4B6',
  color: '#08080e',
  letterSpacing: 0.3,
};
const bs = {
  width: '100%',
  padding: '11px',
  borderRadius: 10,
  fontSize: 12,
  fontWeight: 700,
  border: 'none',
  cursor: 'pointer',
  background: '#141420',
  color: '#666',
};

function RiskBadge({ level, color, score }) {
  return (
    <span
      style={{
        padding: '2px 8px',
        borderRadius: 20,
        fontSize: 9,
        fontWeight: 800,
        background: `${color}1a`,
        color,
        border: `1px solid ${color}33`,
        letterSpacing: 0.8,
        whiteSpace: 'nowrap',
      }}
    >
      {level} · {score}
    </span>
  );
}
function StatCard({ value, label, color }) {
  return (
    <div
      style={{
        flex: 1,
        background: '#111',
        border: '1px solid #1a1a1a',
        borderRadius: 10,
        padding: '9px 10px',
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 800, color, lineHeight: 1 }}>
        {value}
      </div>
      <div
        style={{
          fontSize: 8,
          color: '#444',
          marginTop: 3,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        {label}
      </div>
    </div>
  );
}

const STEPS = ['Setup', 'VPAs', 'Risk', 'Clean Up'];
function StepIndicator({ current }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 22 }}>
      {STEPS.map((s, i) => (
        <div
          key={s}
          style={{
            display: 'flex',
            alignItems: 'center',
            flex: i < STEPS.length - 1 ? 1 : 'none',
          }}
        >
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              flexShrink: 0,
              background:
                i < current
                  ? '#2EC4B6'
                  : i === current
                  ? '#fff'
                  : 'transparent',
              border:
                i === current
                  ? '2px solid #fff'
                  : i < current
                  ? '2px solid #2EC4B6'
                  : '2px solid #2a2a2a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 9,
              fontWeight: 700,
              color: i <= current ? '#08080e' : '#444',
              transition: 'all 0.3s',
            }}
          >
            {i < current ? '✓' : i + 1}
          </div>
          <span
            style={{
              marginLeft: 4,
              fontSize: 10,
              fontWeight: i === current ? 700 : 400,
              color: i === current ? '#fff' : i < current ? '#2EC4B6' : '#333',
              whiteSpace: 'nowrap',
            }}
          >
            {s}
          </span>
          {i < STEPS.length - 1 && (
            <div
              style={{
                flex: 1,
                height: 1,
                background: i < current ? '#2EC4B6' : '#1e1e1e',
                margin: '0 7px',
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// SIM CARD ENTRY
// ─────────────────────────────────────────────

function SIMCard({ sim, index, onChange, onRemove, canRemove }) {
  const toggle = (id, key) => {
    const l = sim[key];
    onChange({
      ...sim,
      [key]: l.includes(id) ? l.filter((x) => x !== id) : [...l, id],
    });
  };
  return (
    <div
      style={{
        background: '#0d0d14',
        border: '1px solid #1e1e28',
        borderRadius: 12,
        padding: '14px',
        marginBottom: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 11,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: '#2EC4B6',
            letterSpacing: 1,
          }}
        >
          SIM {index + 1}
        </span>
        {canRemove && (
          <button
            onClick={onRemove}
            style={{
              background: 'none',
              border: '1px solid #252525',
              borderRadius: 5,
              color: '#444',
              cursor: 'pointer',
              fontSize: 9,
              padding: '2px 7px',
            }}
          >
            remove
          </button>
        )}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 9,
          marginBottom: 11,
        }}
      >
        <div style={{ gridColumn: '1/-1' }}>
          <label style={ls}>Mobile number</label>
          <input
            value={sim.mobile}
            onChange={(e) =>
              onChange({
                ...sim,
                mobile: e.target.value.replace(/\D/g, '').slice(0, 10),
              })
            }
            placeholder="9XXXXXXXXX"
            style={is}
          />
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <label style={ls}>Label (e.g. "Old SIM", "Work")</label>
          <input
            value={sim.label}
            onChange={(e) => onChange({ ...sim, label: e.target.value })}
            placeholder="optional"
            style={is}
          />
        </div>
        <div>
          <label style={ls}>Last used (year)</label>
          <select
            value={sim.lastUsed}
            onChange={(e) =>
              onChange({ ...sim, lastUsed: parseInt(e.target.value) })
            }
            style={is}
          >
            {[2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={ls}>Phone status</label>
          <select
            value={sim.phoneStatus}
            onChange={(e) => onChange({ ...sim, phoneStatus: e.target.value })}
            style={is}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="changed">Changed / Surrendered</option>
          </select>
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <label style={ls}>Bank account status</label>
          <select
            value={sim.bankStatus}
            onChange={(e) => onChange({ ...sim, bankStatus: e.target.value })}
            style={is}
          >
            <option value="active">Active</option>
            <option value="dormant">Dormant</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </div>
      <label style={ls}>UPI apps used on this number</label>
      <div
        style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 9 }}
      >
        {PSP_DATA.map((app) => {
          const sel = sim.selectedApps.includes(app.id);
          return (
            <button
              key={app.id}
              onClick={() => toggle(app.id, 'selectedApps')}
              style={{
                padding: '4px 9px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 10,
                fontWeight: 600,
                border: sel
                  ? `1.5px solid ${app.color}`
                  : '1.5px solid #252525',
                background: sel ? `${app.color}18` : '#0d0d0d',
                color: sel ? app.color : '#444',
                transition: 'all 0.15s',
              }}
            >
              {app.shortName}
            </button>
          );
        })}
      </div>
      <label style={ls}>Banks linked on this number</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {BANK_DATA.map((bank) => {
          const sel = sim.selectedBanks.includes(bank.id);
          return (
            <button
              key={bank.id}
              onClick={() => toggle(bank.id, 'selectedBanks')}
              style={{
                padding: '4px 9px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 10,
                fontWeight: 600,
                border: sel
                  ? `1.5px solid ${bank.color}`
                  : '1.5px solid #252525',
                background: sel ? `${bank.color}18` : '#0d0d0d',
                color: sel ? bank.color : '#444',
                transition: 'all 0.15s',
              }}
            >
              {bank.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SHARE MODAL
// ─────────────────────────────────────────────

function ShareModal({ sims, vpas, done, onClose }) {
  const [copied, setCopied] = useState(null);

  const shareURL = encodeStateToURL(sims);
  const shareText = buildTextSummary(sims, vpas, done);

  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2200);
    } catch (_) {}
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.82)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#0c0c16',
          border: '1px solid #252535',
          borderRadius: 14,
          padding: '22px 20px',
          width: '100%',
          maxWidth: 440,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 18,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 800, color: '#ddd' }}>
            Share / Export
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#555',
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Share URL */}
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: '#555',
              letterSpacing: 1,
              textTransform: 'uppercase',
              marginBottom: 7,
            }}
          >
            Share link (pre-fills audit for recipient)
          </div>
          <div
            style={{
              background: '#0d0d12',
              border: '1px solid #1e1e1e',
              borderRadius: 8,
              padding: '9px 11px',
              marginBottom: 7,
              wordBreak: 'break-all',
              fontSize: 10,
              color: '#555',
              fontFamily: 'monospace',
              maxHeight: 54,
              overflow: 'hidden',
              lineHeight: 1.4,
            }}
          >
            {shareURL
              ? shareURL.slice(0, 120) + '…'
              : 'URL encoding not available'}
          </div>
          <button
            onClick={() => copy(shareURL, 'url')}
            style={{ ...bp, fontSize: 11, padding: '8px' }}
          >
            {copied === 'url' ? '✓ Copied!' : 'Copy Share Link'}
          </button>
          <div
            style={{
              fontSize: 9,
              color: '#333',
              marginTop: 5,
              lineHeight: 1.5,
            }}
          >
            ⚠ Link contains your mobile numbers. Only share with trusted
            contacts or yourself.
          </div>
        </div>

        <div style={{ height: 1, background: '#181820', margin: '16px 0' }} />

        {/* Text summary */}
        <div>
          <div
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: '#555',
              letterSpacing: 1,
              textTransform: 'uppercase',
              marginBottom: 7,
            }}
          >
            Text summary (masked numbers — safe for WhatsApp/email)
          </div>
          <pre
            style={{
              background: '#0d0d12',
              border: '1px solid #1e1e1e',
              borderRadius: 8,
              padding: '9px 11px',
              marginBottom: 7,
              fontSize: 9,
              color: '#777',
              fontFamily: 'monospace',
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
              maxHeight: 140,
              overflowY: 'auto',
              lineHeight: 1.6,
            }}
          >
            {shareText}
          </pre>
          <button
            onClick={() => copy(shareText, 'text')}
            style={{
              ...bp,
              fontSize: 11,
              padding: '8px',
              background: '#1a1a28',
              color: '#aaa',
            }}
          >
            {copied === 'text' ? '✓ Copied!' : 'Copy Text Summary'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// STEP 0 — SETUP
// ─────────────────────────────────────────────

const blankSIM = () => ({
  id: Math.random().toString(36).slice(2),
  mobile: '',
  label: '',
  lastUsed: 2022,
  phoneStatus: 'active',
  bankStatus: 'active',
  selectedApps: [],
  selectedBanks: [],
});

function Step0Setup({ onNext, initialSims }) {
  const [sims, setSims] = useState(initialSims || [blankSIM()]);
  const updateSIM = (i, val) =>
    setSims(sims.map((s, j) => (j === i ? val : s)));
  const valid = sims.every(
    (s) =>
      s.mobile.length === 10 &&
      s.selectedApps.length + s.selectedBanks.length > 0
  );
  return (
    <div>
      <h2
        style={{
          fontSize: 19,
          fontWeight: 800,
          color: '#fff',
          marginBottom: 4,
        }}
      >
        Set up your audit
      </h2>
      <p
        style={{
          color: '#555',
          fontSize: 11,
          marginBottom: 16,
          lineHeight: 1.5,
        }}
      >
        Add every number you've used for UPI — current and old SIMs. All data
        stays local.
      </p>
      {sims.map((sim, i) => (
        <SIMCard
          key={sim.id}
          sim={sim}
          index={i}
          onChange={(val) => updateSIM(i, val)}
          onRemove={() => setSims(sims.filter((_, j) => j !== i))}
          canRemove={sims.length > 1}
        />
      ))}
      <button
        onClick={() => setSims([...sims, blankSIM()])}
        style={{
          width: '100%',
          padding: '9px',
          borderRadius: 10,
          fontSize: 11,
          fontWeight: 700,
          border: '1.5px dashed #252525',
          background: 'transparent',
          color: '#444',
          cursor: 'pointer',
          marginBottom: 14,
          letterSpacing: 0.3,
        }}
      >
        + Add another SIM / old number
      </button>
      <button
        onClick={() => valid && onNext(sims)}
        disabled={!valid}
        style={{
          ...bp,
          background: valid ? '#2EC4B6' : '#141420',
          color: valid ? '#08080e' : '#2a2a2a',
          cursor: valid ? 'pointer' : 'not-allowed',
        }}
      >
        Generate VPA List →
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────
// STEP 1 — VPA LIST
// ─────────────────────────────────────────────

function Step1VPAs({ sims, vpas, onNext, onBack }) {
  const grouped = sims.map((s, idx) => ({
    ...s,
    simVPAs: vpas.filter((v) => v.mobile === s.mobile),
    dl: s.label || `SIM ${idx + 1}`,
  }));
  return (
    <div>
      <h2
        style={{
          fontSize: 19,
          fontWeight: 800,
          color: '#fff',
          marginBottom: 4,
        }}
      >
        Your likely UPI IDs
      </h2>
      <p
        style={{
          color: '#555',
          fontSize: 11,
          marginBottom: 13,
          lineHeight: 1.5,
        }}
      >
        Based on standard VPA handle patterns. Verify each via the actual app or
        *99#.
      </p>
      <div style={{ display: 'flex', gap: 7, marginBottom: 16 }}>
        <StatCard value={vpas.length} label="Total VPAs" color="#fff" />
        <StatCard
          value={vpas.filter((v) => v.risk.level === 'HIGH').length}
          label="High Risk"
          color="#FF4444"
        />
        <StatCard
          value={vpas.filter((v) => v.risk.level === 'MEDIUM').length}
          label="Medium"
          color="#FF9F1C"
        />
        <StatCard value={sims.length} label="SIMs" color="#7B61FF" />
      </div>
      {grouped.map((g, gi) => (
        <div key={gi} style={{ marginBottom: 15 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              marginBottom: 6,
            }}
          >
            <span
              style={{
                fontSize: 8,
                fontWeight: 800,
                color: '#7B61FF',
                background: '#7B61FF18',
                border: '1px solid #7B61FF33',
                borderRadius: 4,
                padding: '2px 7px',
                letterSpacing: 1,
                textTransform: 'uppercase',
              }}
            >
              {g.dl}
            </span>
            <span
              style={{ fontSize: 9, color: '#333', fontFamily: 'monospace' }}
            >
              +91 {g.mobile}
            </span>
          </div>
          {g.simVPAs.map((v, i) => (
            <div
              key={i}
              style={{
                background: '#0d0d12',
                border: '1px solid #181818',
                borderLeft: `3px solid ${v.color}`,
                borderRadius: 7,
                padding: '9px 11px',
                marginBottom: 5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: 'monospace',
                    fontSize: 11,
                    color: '#ccc',
                    fontWeight: 600,
                  }}
                >
                  {v.vpa}
                </div>
                <div style={{ fontSize: 9, color: '#444', marginTop: 1 }}>
                  {v.appName}
                </div>
              </div>
              <RiskBadge
                level={v.risk.level}
                color={v.risk.color}
                score={v.risk.score}
              />
            </div>
          ))}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button onClick={onBack} style={{ ...bs, flex: '0 0 70px' }}>
          ← Back
        </button>
        <button onClick={onNext} style={bp}>
          View Risk Details →
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// STEP 2 — RISK AUDIT
// ─────────────────────────────────────────────

function Step2Risk({ vpas, onNext, onBack }) {
  const sorted = [...vpas].sort((a, b) => b.risk.score - a.risk.score);
  const byLevel = {
    HIGH: sorted.filter((v) => v.risk.level === 'HIGH'),
    MEDIUM: sorted.filter((v) => v.risk.level === 'MEDIUM'),
    LOW: sorted.filter((v) => v.risk.level === 'LOW'),
  };
  const meta = {
    HIGH: { color: '#FF4444', label: 'HIGH RISK — Act immediately' },
    MEDIUM: { color: '#FF9F1C', label: 'MEDIUM RISK — Review soon' },
    LOW: { color: '#2EC4B6', label: 'LOW RISK — Monitor' },
  };
  return (
    <div>
      <h2
        style={{
          fontSize: 19,
          fontWeight: 800,
          color: '#fff',
          marginBottom: 4,
        }}
      >
        Risk breakdown
      </h2>
      <p
        style={{
          color: '#555',
          fontSize: 11,
          marginBottom: 16,
          lineHeight: 1.5,
        }}
      >
        Address HIGH items first. Score combines idle time, phone status, and
        bank account status.
      </p>
      {Object.entries(byLevel)
        .filter(([, vs]) => vs.length > 0)
        .map(([level, vs]) => (
          <div key={level} style={{ marginBottom: 16 }}>
            <div
              style={{
                fontSize: 8,
                fontWeight: 800,
                color: meta[level].color,
                letterSpacing: 1.2,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}
            >
              {meta[level].label} ({vs.length})
            </div>
            {vs.map((v, i) => (
              <div
                key={i}
                style={{
                  background: '#0a0a10',
                  border: `1px solid ${v.risk.color}20`,
                  borderRadius: 9,
                  padding: '10px 11px',
                  marginBottom: 6,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: 5,
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontFamily: 'monospace',
                        fontSize: 11,
                        color: '#ccc',
                      }}
                    >
                      {v.vpa}
                    </div>
                    <div style={{ fontSize: 8, color: '#444', marginTop: 2 }}>
                      {v.appName} · {v.simLabel}
                    </div>
                  </div>
                  <RiskBadge
                    level={v.risk.level}
                    color={v.risk.color}
                    score={v.risk.score}
                  />
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {v.risk.flags.map((f, j) => (
                    <span
                      key={j}
                      style={{
                        fontSize: 8,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: '#141414',
                        color: '#555',
                        border: '1px solid #202020',
                      }}
                    >
                      ⚠ {f}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onBack} style={{ ...bs, flex: '0 0 70px' }}>
          ← Back
        </button>
        <button onClick={onNext} style={bp}>
          Start Cleanup →
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// STEP 3 — CLEANUP
// ─────────────────────────────────────────────

function Step3Cleanup({ vpas, sims, done, setDone, onBack }) {
  const [expanded, setExpanded] = useState(null);
  const [showUSSD, setShowUSSD] = useState(false);
  const [reminderOK, setReminderOK] = useState(false);
  const [showShare, setShowShare] = useState(false);

  const sorted = [...vpas].sort((a, b) => b.risk.score - a.risk.score);
  const toggleDone = (vpa) =>
    setDone((d) =>
      d.includes(vpa) ? d.filter((x) => x !== vpa) : [...d, vpa]
    );
  const progress = sorted.length > 0 ? (done.length / sorted.length) * 100 : 0;

  return (
    <div>
      {showShare && (
        <ShareModal
          sims={sims}
          vpas={vpas}
          done={done}
          onClose={() => setShowShare(false)}
        />
      )}

      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 4,
        }}
      >
        <div>
          <h2
            style={{ fontSize: 19, fontWeight: 800, color: '#fff', margin: 0 }}
          >
            Cleanup checklist
          </h2>
          <p style={{ color: '#555', fontSize: 11, marginTop: 3 }}>
            {done.length} of {sorted.length} cleaned up
          </p>
        </div>
        <div style={{ display: 'flex', gap: 5 }}>
          <button
            onClick={() => exportToPDF(vpas, sims)}
            style={{
              padding: '5px 8px',
              borderRadius: 6,
              fontSize: 9,
              fontWeight: 700,
              border: '1px solid #252525',
              background: '#0d0d12',
              color: '#777',
              cursor: 'pointer',
            }}
          >
            ↓ PDF
          </button>
          <button
            onClick={() => setShowShare(true)}
            style={{
              padding: '5px 8px',
              borderRadius: 6,
              fontSize: 9,
              fontWeight: 700,
              border: '1px solid #252525',
              background: '#0d0d12',
              color: '#777',
              cursor: 'pointer',
            }}
          >
            ⬆ Share
          </button>
          <button
            onClick={() => {
              downloadICS();
              setReminderOK(true);
            }}
            style={{
              padding: '5px 8px',
              borderRadius: 6,
              fontSize: 9,
              fontWeight: 700,
              border: `1px solid ${reminderOK ? '#2EC4B644' : '#252525'}`,
              background: reminderOK ? '#2EC4B610' : '#0d0d12',
              color: reminderOK ? '#2EC4B6' : '#777',
              cursor: 'pointer',
            }}
          >
            {reminderOK ? '✓' : '⏱'}
          </button>
        </div>
      </div>

      {/* Progress */}
      <div
        style={{
          height: 3,
          background: '#151515',
          borderRadius: 3,
          margin: '11px 0 16px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${progress}%`,
            background: 'linear-gradient(90deg,#2EC4B6,#0a7a72)',
            borderRadius: 3,
            transition: 'width 0.4s ease',
          }}
        />
      </div>

      {/* VPA checklist */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          marginBottom: 14,
        }}
      >
        {sorted.map((v, i) => {
          const isDone = done.includes(v.vpa);
          const isOpen = expanded === v.vpa;
          return (
            <div
              key={i}
              style={{
                background: isDone ? '#0b130b' : '#0d0d12',
                border: isDone ? '1px solid #2EC4B620' : '1px solid #181818',
                borderRadius: 9,
                overflow: 'hidden',
                opacity: isDone ? 0.6 : 1,
                transition: 'all 0.2s',
              }}
            >
              <div
                onClick={() => setExpanded(isOpen ? null : v.vpa)}
                style={{
                  padding: '9px 11px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleDone(v.vpa);
                    }}
                    style={{
                      width: 15,
                      height: 15,
                      borderRadius: 3,
                      flexShrink: 0,
                      border: `2px solid ${isDone ? '#2EC4B6' : v.risk.color}`,
                      background: isDone ? '#2EC4B6' : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 7,
                      color: isDone ? '#08080e' : 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    ✓
                  </div>
                  <div>
                    <div
                      style={{
                        fontFamily: 'monospace',
                        fontSize: 11,
                        color: isDone ? '#3a3a3a' : '#ccc',
                        fontWeight: 600,
                      }}
                    >
                      {v.vpa}
                    </div>
                    <div
                      style={{ fontSize: 8, color: '#3a3a3a', marginTop: 1 }}
                    >
                      {v.appName} · {v.simLabel}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <RiskBadge
                    level={v.risk.level}
                    color={v.risk.color}
                    score={v.risk.score}
                  />
                  <span style={{ color: '#2a2a2a', fontSize: 9 }}>
                    {isOpen ? '▲' : '▼'}
                  </span>
                </div>
              </div>
              {isOpen && (
                <div
                  style={{
                    padding: '0 11px 11px',
                    borderTop: '1px solid #141414',
                  }}
                >
                  <div
                    style={{
                      fontSize: 9,
                      color: '#444',
                      margin: '8px 0 6px',
                      textTransform: 'uppercase',
                      letterSpacing: 0.8,
                    }}
                  >
                    Steps to remove
                  </div>
                  {(v.cleanupSteps || ['Contact your bank directly']).map(
                    (step, j) => (
                      <div
                        key={j}
                        style={{
                          display: 'flex',
                          gap: 7,
                          marginBottom: 5,
                          alignItems: 'flex-start',
                        }}
                      >
                        <span
                          style={{
                            minWidth: 14,
                            height: 14,
                            borderRadius: '50%',
                            background: '#111',
                            border: '1px solid #222',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 7,
                            color: '#555',
                            flexShrink: 0,
                          }}
                        >
                          {j + 1}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            color: '#888',
                            lineHeight: 1.5,
                          }}
                        >
                          {step}
                        </span>
                      </div>
                    )
                  )}
                  <button
                    onClick={() => toggleDone(v.vpa)}
                    style={{
                      marginTop: 8,
                      padding: '4px 11px',
                      borderRadius: 5,
                      fontSize: 9,
                      fontWeight: 700,
                      cursor: 'pointer',
                      border: 'none',
                      background: isDone ? '#1a2a1a' : '#2EC4B6',
                      color: isDone ? '#2EC4B6' : '#08080e',
                    }}
                  >
                    {isDone ? '✓ Mark as pending' : 'Mark as cleaned up ✓'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* All done */}
      {done.length === sorted.length && sorted.length > 0 && (
        <div
          style={{
            background: '#0b130b',
            border: '1px solid #2EC4B630',
            borderRadius: 10,
            padding: '11px',
            textAlign: 'center',
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 17, marginBottom: 3 }}>✓</div>
          <div style={{ color: '#2EC4B6', fontWeight: 700, fontSize: 12 }}>
            All VPAs cleaned up
          </div>
          <div style={{ color: '#3a3a3a', fontSize: 9, marginTop: 3 }}>
            Use ⏱ to set a 6-month re-audit reminder.
          </div>
        </div>
      )}

      {/* *99# USSD */}
      <div style={{ marginBottom: 12 }}>
        <button
          onClick={() => setShowUSSD(!showUSSD)}
          style={{
            width: '100%',
            padding: '9px 11px',
            borderRadius: showUSSD ? '9px 9px 0 0' : 9,
            cursor: 'pointer',
            background: '#0d0d12',
            border: '1px solid #1e1e28',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span
              style={{
                fontSize: 9,
                fontWeight: 800,
                color: '#FFD700',
                background: '#FFD70010',
                border: '1px solid #FFD70022',
                borderRadius: 4,
                padding: '1px 5px',
              }}
            >
              *99#
            </span>
            <span style={{ fontSize: 11, color: '#888', fontWeight: 600 }}>
              USSD Verification Guide
            </span>
          </div>
          <span style={{ color: '#333', fontSize: 9 }}>
            {showUSSD ? '▲' : '▼'}
          </span>
        </button>
        {showUSSD && (
          <div
            style={{
              background: '#080810',
              border: '1px solid #1e1e28',
              borderTop: 'none',
              borderRadius: '0 0 9px 9px',
              padding: '11px',
            }}
          >
            <p
              style={{
                fontSize: 10,
                color: '#555',
                marginBottom: 9,
                lineHeight: 1.6,
              }}
            >
              NPCI's USSD service — VPA discovery without internet.
              <span
                style={{ color: '#FF9F1C', display: 'block', marginTop: 2 }}
              >
                ⚠ Read-only. Cannot delete VPAs — use apps for that.
              </span>
            </p>
            {USSD_STEPS.map((s, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  gap: 8,
                  marginBottom: 8,
                  alignItems: 'flex-start',
                }}
              >
                <div
                  style={{
                    minWidth: 19,
                    height: 19,
                    borderRadius: 4,
                    background: '#FFD70010',
                    border: '1px solid #FFD70022',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 8,
                    fontWeight: 800,
                    color: '#FFD700',
                    flexShrink: 0,
                  }}
                >
                  {i + 1}
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#bbb', fontWeight: 600 }}>
                    {s.step}
                  </div>
                  <div
                    style={{
                      fontSize: 9,
                      color: '#444',
                      marginTop: 2,
                      lineHeight: 1.4,
                    }}
                  >
                    {s.detail}
                  </div>
                </div>
              </div>
            ))}
            <div
              style={{
                marginTop: 7,
                padding: '8px 10px',
                background: '#0d0d14',
                borderRadius: 7,
                border: '1px solid #1e1e28',
              }}
            >
              <div
                style={{
                  fontSize: 8,
                  fontWeight: 800,
                  color: '#7B61FF',
                  marginBottom: 4,
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                }}
              >
                For old SIMs specifically
              </div>
              <div style={{ fontSize: 10, color: '#555', lineHeight: 1.5 }}>
                Insert old SIM → Dial *99# → 'My Profile' → Note all registered
                VPAs → Add to cleanup list above.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Actions row */}
      <div
        style={{
          background: '#0d0d12',
          border: '1px solid #181818',
          borderRadius: 10,
          padding: '11px',
          marginBottom: 12,
        }}
      >
        <div
          style={{
            fontSize: 8,
            fontWeight: 700,
            color: '#333',
            letterSpacing: 1.2,
            textTransform: 'uppercase',
            marginBottom: 8,
          }}
        >
          Export & Share
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 6,
          }}
        >
          <button
            onClick={() => exportToPDF(vpas, sims)}
            style={{
              padding: '8px 4px',
              borderRadius: 7,
              fontSize: 9,
              fontWeight: 700,
              border: '1px solid #222',
              background: '#111',
              color: '#888',
              cursor: 'pointer',
            }}
          >
            ↓ PDF
          </button>
          <button
            onClick={() => setShowShare(true)}
            style={{
              padding: '8px 4px',
              borderRadius: 7,
              fontSize: 9,
              fontWeight: 700,
              border: '1px solid #222',
              background: '#111',
              color: '#888',
              cursor: 'pointer',
            }}
          >
            ⬆ Share
          </button>
          <button
            onClick={() => {
              downloadICS();
              setReminderOK(true);
            }}
            style={{
              padding: '8px 4px',
              borderRadius: 7,
              fontSize: 9,
              fontWeight: 700,
              border: `1px solid ${reminderOK ? '#2EC4B640' : '#222'}`,
              background: reminderOK ? '#2EC4B610' : '#111',
              color: reminderOK ? '#2EC4B6' : '#888',
              cursor: 'pointer',
            }}
          >
            {reminderOK ? '✓ Set' : '⏱ Remind'}
          </button>
        </div>
        <div
          style={{ fontSize: 8, color: '#222', marginTop: 7, lineHeight: 1.5 }}
        >
          PDF opens print dialog. Share opens copy options. Remind downloads
          .ics for any calendar app.
        </div>
      </div>

      <button onClick={onBack} style={bs}>
        ← Back
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────
// SESSION RESTORE BANNER
// ─────────────────────────────────────────────

function RestoreBanner({ onDismiss, onClear }) {
  return (
    <div
      style={{
        background: '#0d1420',
        border: '1px solid #2EC4B630',
        borderRadius: 10,
        padding: '10px 14px',
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
      }}
    >
      <div>
        <div style={{ fontSize: 11, color: '#2EC4B6', fontWeight: 700 }}>
          Session restored
        </div>
        <div style={{ fontSize: 9, color: '#3a5a50', marginTop: 2 }}>
          Your previous audit was loaded from local storage.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button
          onClick={onClear}
          style={{
            padding: '4px 9px',
            borderRadius: 6,
            fontSize: 9,
            fontWeight: 700,
            border: '1px solid #333',
            background: 'transparent',
            color: '#555',
            cursor: 'pointer',
          }}
        >
          Clear
        </button>
        <button
          onClick={onDismiss}
          style={{
            padding: '4px 9px',
            borderRadius: 6,
            fontSize: 9,
            fontWeight: 700,
            border: 'none',
            background: '#2EC4B620',
            color: '#2EC4B6',
            cursor: 'pointer',
          }}
        >
          OK
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────

export default function App() {
  const [step, setStep] = useState(0);
  const [sims, setSims] = useState(null);
  const [done, setDone] = useState([]);
  const [restored, setRestored] = useState(false);
  const [showBanner, setShowBanner] = useState(false);

  // On mount: try URL decode first, then localStorage
  useEffect(() => {
    const fromURL = decodeStateFromURL();
    if (fromURL?.sims) {
      setSims(fromURL.sims);
      setStep(1);
      setRestored(true);
      setShowBanner(true);
      return;
    }
    const fromStorage = loadSession();
    if (fromStorage?.sims) {
      setSims(fromStorage.sims);
      setStep(fromStorage.step ?? 1);
      setDone(fromStorage.done ?? []);
      setRestored(true);
      setShowBanner(true);
    }
  }, []);

  // Auto-save on every state change
  useEffect(() => {
    if (sims) saveSession({ sims, step, done });
  }, [sims, step, done]);

  const vpas = useMemo(() => {
    if (!sims) return [];
    return sims.flatMap((s, idx) =>
      generateVPAsForSIM({
        mobile: s.mobile,
        selectedApps: s.selectedApps,
        selectedBanks: s.selectedBanks,
        lastUsed: s.lastUsed,
        phoneStatus: s.phoneStatus,
        bankStatus: s.bankStatus,
        label: s.label || `SIM ${idx + 1}`,
      })
    );
  }, [sims]);

  const handleSetup = useCallback((simData) => {
    setSims(simData);
    setStep(1);
  }, []);

  const handleClearSession = () => {
    clearSession();
    setSims(null);
    setStep(0);
    setDone([]);
    setRestored(false);
    setShowBanner(false);
  };

  const navigate = useCallback((n) => setStep(n), []);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#08080e',
        fontFamily: "'DM Mono','Courier New',monospace",
        display: 'flex',
        justifyContent: 'center',
        padding: '22px 14px',
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        select option{background:#111;color:#ddd}
        ::-webkit-scrollbar{width:3px}
        ::-webkit-scrollbar-thumb{background:#1e1e1e;border-radius:3px}
        input::placeholder{color:#2a2a2a}
        input:focus,select:focus{border-color:#303040!important;outline:none}
        button:hover{opacity:0.82}
      `}</style>

      <div style={{ width: '100%', maxWidth: 500 }}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 20,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div
              style={{
                width: 31,
                height: 31,
                borderRadius: 8,
                background: 'linear-gradient(135deg,#2EC4B6,#0a7a72)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 15,
                fontWeight: 800,
                color: '#08080e',
                flexShrink: 0,
              }}
            >
              ₹
            </div>
            <div>
              <div
                style={{
                  fontFamily: "'Syne',sans-serif",
                  fontSize: 16,
                  fontWeight: 800,
                  color: '#e0e0e0',
                  letterSpacing: -0.5,
                }}
              >
                UPI AUDIT
              </div>
              <div
                style={{
                  fontSize: 8,
                  color: '#252530',
                  letterSpacing: 2,
                  textTransform: 'uppercase',
                }}
              >
                Find · Risk-Score · Clean Up · v0.3
              </div>
            </div>
          </div>
          {sims && (
            <button
              onClick={handleClearSession}
              style={{
                padding: '4px 9px',
                borderRadius: 6,
                fontSize: 9,
                fontWeight: 700,
                border: '1px solid #252525',
                background: 'transparent',
                color: '#444',
                cursor: 'pointer',
              }}
            >
              Reset
            </button>
          )}
        </div>

        {showBanner && (
          <RestoreBanner
            onDismiss={() => setShowBanner(false)}
            onClear={handleClearSession}
          />
        )}

        <StepIndicator current={step} />

        <div
          style={{
            background: '#0c0c14',
            border: '1px solid #14141e',
            borderRadius: 14,
            padding: '20px 17px',
            boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
          }}
        >
          {step === 0 && <Step0Setup onNext={handleSetup} initialSims={sims} />}
          {step === 1 && (
            <Step1VPAs
              sims={sims}
              vpas={vpas}
              onNext={() => navigate(2)}
              onBack={() => navigate(0)}
            />
          )}
          {step === 2 && (
            <Step2Risk
              vpas={vpas}
              onNext={() => navigate(3)}
              onBack={() => navigate(1)}
            />
          )}
          {step === 3 && (
            <Step3Cleanup
              vpas={vpas}
              sims={sims}
              done={done}
              setDone={setDone}
              onBack={() => navigate(2)}
            />
          )}
        </div>

        <div
          style={{
            textAlign: 'center',
            marginTop: 11,
            fontSize: 8,
            color: '#18181e',
            letterSpacing: 0.8,
          }}
        >
          No data stored or transmitted externally · Local-only · India UPI
        </div>
      </div>
    </div>
  );
}
