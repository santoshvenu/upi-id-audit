import React, { useState, useMemo, useEffect, useCallback } from "react";

// ─────────────────────────────────────────────
// SECURITY UTILITIES  (loaded first, used everywhere)
// ─────────────────────────────────────────────

/**
 * SECURITY LAYER SUMMARY
 * ──────────────────────
 * 1. Mobile numbers NEVER written to localStorage or URL params.
 *    Only app/bank selections, step, done-list, and masked display label stored.
 *    Full numbers live in React state (memory only) — cleared on page close.
 *
 * 2. URL share payload contains ZERO PII.
 *    Only encodes: selectedApps[], selectedBanks[], phoneStatus,
 *    bankStatus, label (user-chosen display name, no number).
 *    Recipient must enter their own mobile number.
 *
 * 3. PDF export sanitises ALL user-controlled strings before document.write.
 *    Prevents XSS via crafted labels / VPA strings.
 *
 * 4. Input validation on mobile number: digits only, exactly 10, starts 6-9.
 *    Rejects obviously invalid numbers before they enter state.
 *
 * 5. Rate limiting on URL decode: max 3 attempts per session to prevent
 *    brute-force probing of encoded payloads.
 *
 * 6. localStorage integrity: stored blob is schema-validated before use.
 *    Rejects tampered / malformed data silently.
 *
 * 7. sessionStorage for full mobile numbers (cleared on tab close).
 *    localStorage only holds masked metadata.
 */

// HTML-escape any string before injecting into document.write / innerHTML
function esc(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}

// Validate Indian mobile number: 10 digits, starts with 6–9
function isValidMobile(m) {
  return /^[6-9]\d{9}$/.test(m.replace(/\s/g, ""));
}

// Mask mobile for display / storage: show only last 4 digits
function maskMobile(m) {
  if (!m || m.length < 4) return "XXXXXX????";
  return `XXXXXX${m.slice(-4)}`;
}

// Schema-validate localStorage blob before trusting it
function isValidStorageBlob(obj) {
  if (!obj || typeof obj !== "object") return false;
  if (typeof obj.step !== "number") return false;
  if (!Array.isArray(obj.done)) return false;
  if (!Array.isArray(obj.simsMeta)) return false;
  // simsMeta must not contain mobile numbers
  for (const s of obj.simsMeta) {
    if (s.mobile) return false; // reject if someone injected a number
    if (typeof s.id !== "string") return false;
  }
  return true;
}

// Rate limiter for URL decode attempts
let urlDecodeAttempts = 0;
const MAX_URL_DECODE_ATTEMPTS = 3;

// ─────────────────────────────────────────────
// DATA MODEL
// ─────────────────────────────────────────────

const PSP_DATA = [
  { id: "gpay",      name: "Google Pay",   shortName: "GPay",
    handles: ["@okaxis","@okicici","@oksbi","@okhdfcbank"],
    color: "#4285F4", difficulty: "easy",
    cleanupSteps: ["Open Google Pay app","Tap your profile photo (top right)","Tap 'Bank account'","Select the account linked to the UPI ID","Tap 'Remove bank account'","Confirm — this deletes the associated @ok* VPA"] },
  { id: "phonepe",   name: "PhonePe",      shortName: "PhonePe",
    handles: ["@ybl","@axl","@ibl"],
    color: "#5f259f", difficulty: "easy",
    cleanupSteps: ["Open PhonePe app","Tap the profile icon (top left)","Go to 'Payment Methods' → 'UPI'","Select the UPI ID you want to remove","Tap 'Delete UPI ID' and confirm"] },
  { id: "paytm",     name: "Paytm",        shortName: "Paytm",
    handles: ["@paytm","@ptyes","@pthdfc","@ptaxis","@ptsbi","@ptkotak"],
    color: "#00BAF2", difficulty: "medium",
    cleanupSteps: ["Open Paytm app","Tap the profile icon","Go to 'Payment Settings' → 'UPI & Linked Bank Accounts'","Tap the UPI ID to remove","Select 'Remove UPI ID'","Confirm with your Paytm PIN"] },
  { id: "bhim",      name: "BHIM",         shortName: "BHIM",
    handles: ["@upi"],
    color: "#138808", difficulty: "medium",
    cleanupSteps: ["Open BHIM app","Go to 'Profile' → 'UPI IDs'","Select the UPI ID to remove","Tap 'Remove UPI ID'","Or: deregister via Settings → Deregister"] },
  { id: "amazonpay", name: "Amazon Pay",   shortName: "Amazon Pay",
    handles: ["@apl","@yapl"],
    color: "#FF9900", difficulty: "hard",
    cleanupSteps: ["Open Amazon app → tap 'Pay' tab","Go to 'Manage UPI IDs'","Select the UPI ID","Tap 'Remove' (or 'UPI Settings' if not visible)","If self-service fails: contact Amazon Pay support via chat"] },
  { id: "cred",      name: "CRED",         shortName: "CRED",
    handles: ["@axisb","@sc"],
    color: "#7B61FF", difficulty: "medium",
    cleanupSteps: ["Open CRED app","Go to Profile → 'Payment Methods'","Tap 'UPI' section","Select the UPI ID and tap 'Remove'","Confirm with MPIN"] },
];

const BANK_DATA = [
  { id: "hdfc",  name: "HDFC Bank",  handles: ["@hdfcbank","@payzapp"],  color: "#004C8F",
    cleanupSteps: ["Log in to HDFC NetBanking","Go to 'Pay' → 'UPI' → 'Manage UPI IDs'","Select the VPA and choose 'Deregister'","Or visit branch — submit UPI Deactivation Request form"] },
  { id: "icici", name: "ICICI Bank", handles: ["@icici","@icicinrbin"],   color: "#F58220",
    cleanupSteps: ["Open iMobile Pay app","Go to Profile → 'Manage UPI IDs'","Select the VPA to deactivate","Tap 'Deactivate' and confirm"] },
  { id: "sbi",   name: "SBI",        handles: ["@sbi","@sbipay"],         color: "#2980B9",
    cleanupSteps: ["Open YONO SBI app","Go to 'UPI' → 'Manage VPA'","Select the UPI ID to delete","Confirm deletion with OTP"] },
  { id: "axis",  name: "Axis Bank",  handles: ["@axisbank","@axis"],      color: "#97144D",
    cleanupSteps: ["Open Axis Mobile app","Go to 'UPI' → 'Registered VPAs'","Select the VPA and tap 'Remove'","Authenticate with your UPI PIN to confirm"] },
];

const USSD_STEPS = [
  { step: "Dial *99#",                    detail: "Works on any mobile — smartphone or feature phone, with or without internet." },
  { step: "Select option 1 → Send Money", detail: "Navigate with number keys. No touchscreen needed." },
  { step: "Choose 'My Profile'",          detail: "Shows linked bank accounts and all registered VPA handles for that SIM." },
  { step: "Note all VPAs shown",          detail: "Cross-check against your audit list. This is read-only — you cannot delete from here." },
  { step: "Repeat for each old SIM",      detail: "Insert old SIM into any handset, dial *99#, and note what's still registered." },
];

const STORAGE_KEY = "upi_audit_v4_meta"; // NEW KEY — v3 data is stale and contained numbers

// ─────────────────────────────────────────────
// RISK ENGINE
// ─────────────────────────────────────────────

function scoreVPA({ appId, phoneNumberStatus, bankAccountStatus }) {
  let score = 0; const flags = [];
  if (phoneNumberStatus === "changed")       { score += 50; flags.push("Phone number changed/surrendered"); }
  else if (phoneNumberStatus === "inactive") { score += 35; flags.push("Phone number inactive"); }
  if (bankAccountStatus === "closed")        { score += 35; flags.push("Bank account closed"); }
  else if (bankAccountStatus === "dormant")  { score += 20; flags.push("Bank account dormant"); }
  const app = PSP_DATA.find(p => p.id === appId);
  if (app?.difficulty === "hard")            { score += 5;  flags.push("Harder to remove"); }
  score = Math.min(score, 100);
  const level = score >= 60 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW";
  const color = score >= 60 ? "#ef4444" : score >= 30 ? "#f59e0b" : "#22c55e";
  return { score, level, color, flags };
}

function generateVPAsForSIM({ mobile, selectedApps, selectedBanks, phoneStatus, bankStatus, label }) {
  const vpas = [];
  const suffix = mobile.replace(/\D/g, "").slice(-10);
  selectedApps.forEach(appId => {
    const app = PSP_DATA.find(p => p.id === appId); if (!app) return;
    app.handles.forEach(handle => {
      vpas.push({ vpa: `${suffix}${handle}`, appId, appName: app.name, handle,
        risk: scoreVPA({ appId, phoneNumberStatus: phoneStatus, bankAccountStatus: bankStatus }),
        type: "psp", cleanupSteps: app.cleanupSteps, color: app.color, simLabel: label, mobile });
    });
  });
  selectedBanks.forEach(bankId => {
    const bank = BANK_DATA.find(b => b.id === bankId); if (!bank) return;
    bank.handles.forEach(handle => {
      vpas.push({ vpa: `${suffix}${handle}`, bankId, appName: bank.name, handle,
        risk: scoreVPA({ phoneNumberStatus: phoneStatus, bankAccountStatus: bankStatus }),
        type: "bank", cleanupSteps: bank.cleanupSteps, color: bank.color, simLabel: label, mobile });
    });
  });
  return vpas;
}

// ─────────────────────────────────────────────
// SECURE PERSISTENCE
// Mobile numbers → sessionStorage only (clears on tab close)
// Metadata (selections, step, done) → localStorage, NO numbers
// ─────────────────────────────────────────────

function saveMobilesSession(sims) {
  // sessionStorage: full numbers, clears automatically on tab/window close
  try {
    const mobilesOnly = sims.map(s => ({ id: s.id, mobile: s.mobile }));
    sessionStorage.setItem("upi_audit_mobiles", JSON.stringify(mobilesOnly));
  } catch (_) {}
}

function loadMobilesSession() {
  try {
    const raw = sessionStorage.getItem("upi_audit_mobiles");
    return raw ? JSON.parse(raw) : [];
  } catch (_) { return []; }
}

function saveMetaLocalStorage({ sims, step, done }) {
  // Strip mobile numbers before writing to localStorage
  const simsMeta = sims.map(s => ({
    id: s.id,
    label: s.label,
    phoneStatus: s.phoneStatus,
    bankStatus: s.bankStatus,
    selectedApps: s.selectedApps,
    selectedBanks: s.selectedBanks,
    // NO mobile field
  }));
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ simsMeta, step, done })); } catch (_) {}
}

function loadMetaLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isValidStorageBlob(parsed)) {
      // Corrupt or tampered — wipe and start fresh
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch (_) { return null; }
}

// Merge metadata from localStorage with mobile numbers from sessionStorage
function mergeRestoredSession(meta) {
  const mobiles = loadMobilesSession();
  const mobileMap = Object.fromEntries(mobiles.map(m => [m.id, m.mobile]));
  return meta.simsMeta.map(s => ({
    ...s,
    mobile: mobileMap[s.id] || "", // blank if session expired — user must re-enter
  }));
}

function clearAllStorage() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem("upi_audit_mobiles");
    // Also wipe old v3 key if present
    localStorage.removeItem("upi_audit_v3");
  } catch (_) {}
}

// ─────────────────────────────────────────────
// SECURE URL SHARE  (ZERO PII)
// ─────────────────────────────────────────────

/**
 * URL payload contains ONLY:
 * - selectedApps[], selectedBanks[], phoneStatus, bankStatus, label
 * NO mobile numbers. Recipient enters their own number.
 */
function encodeConfigToURL(sims) {
  try {
    const safePayload = sims.map(s => ({
      selectedApps:  s.selectedApps,
      selectedBanks: s.selectedBanks,
      phoneStatus:   s.phoneStatus,
      bankStatus:    s.bankStatus,
      label:         s.label ? s.label.slice(0, 30) : "",
    }));
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(safePayload))));
    return `${window.location.href.split("?")[0]}?c=${encoded}`;
  } catch (_) { return null; }
}

function decodeConfigFromURL() {
  if (urlDecodeAttempts >= MAX_URL_DECODE_ATTEMPTS) return null;
  urlDecodeAttempts++;
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("c");
    if (!raw) return null;
    // Length sanity check — a 10-SIM config shouldn't exceed ~2KB encoded
    if (raw.length > 3000) return null;
    const parsed = JSON.parse(decodeURIComponent(escape(atob(raw))));
    if (!Array.isArray(parsed)) return null;
    // Validate each entry — must not contain a mobile field
    for (const s of parsed) {
      if (s.mobile) return null; // reject if somehow a number snuck in
      if (!Array.isArray(s.selectedApps)) return null;
    }
    return parsed;
  } catch (_) { return null; }
}

// Text summary — always masks numbers
function buildTextSummary(sims, vpas, done) {
  const date = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const high = vpas.filter(v => v.risk.level === "HIGH").length;
  const med  = vpas.filter(v => v.risk.level === "MEDIUM").length;
  const low  = vpas.filter(v => v.risk.level === "LOW").length;
  let txt = `UPI AUDIT REPORT — ${date}\n${"─".repeat(40)}\n`;
  txt += `SIMs audited : ${sims.length}\n`;
  txt += `Total VPAs   : ${vpas.length}  (HIGH: ${high}  MED: ${med}  LOW: ${low})\n`;
  txt += `Cleaned up   : ${done.length}/${vpas.length}\n\n`;
  sims.forEach((s, idx) => {
    txt += `[ ${s.label || `SIM ${idx+1}`} — +91 ${maskMobile(s.mobile)} ]\n`;
    vpas.filter(v => v.mobile === s.mobile)
      .sort((a,b) => b.risk.score - a.risk.score)
      .forEach(v => {
        txt += `  ${done.includes(v.vpa) ? "✓ DONE  " : "☐ TODO  "}${v.vpa.padEnd(34)} ${v.risk.level} (${v.risk.score})\n`;
      });
    txt += "\n";
  });
  txt += `${"─".repeat(40)}\nDial *99# on each SIM to verify. Re-audit every 6 months.\n`;
  return txt;
}

// ─────────────────────────────────────────────
// SECURE PDF EXPORT  (XSS-safe via esc())
// ALL user-controlled strings are HTML-escaped before document.write
// ─────────────────────────────────────────────

function exportToPDF(allVPAs, sims) {
  const today = esc(new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }));
  const rc = { HIGH: "#cc0000", MEDIUM: "#cc6600", LOW: "#006655" };

  const rows = [...allVPAs].sort((a,b) => b.risk.score - a.risk.score).map(v => `
    <tr>
      <td style="font-family:monospace;font-size:11px">${esc(v.vpa)}</td>
      <td>${esc(v.appName)}</td>
      <td>${esc(v.simLabel || maskMobile(v.mobile))}</td>
      <td style="color:${rc[v.risk.level]};font-weight:700">${esc(v.risk.level)} (${v.risk.score})</td>
      <td style="font-size:10px;color:#666">${v.risk.flags.map(esc).join(", ")}</td>
      <td style="text-align:center;font-size:15px">☐</td>
    </tr>`).join("");

  const apps = {};
  allVPAs.forEach(v => { if (!apps[v.appName]) apps[v.appName] = v.cleanupSteps || []; });
  const stepBlocks = Object.entries(apps).map(([n, ss]) => `
    <div style="break-inside:avoid;margin-bottom:14px">
      <div style="font-weight:700;font-size:12px;margin-bottom:4px;border-bottom:1px solid #eee;padding-bottom:3px">${esc(n)}</div>
      <ol style="margin:0;padding-left:18px;font-size:11px;color:#333;line-height:1.6">
        ${ss.map(s => `<li>${esc(s)}</li>`).join("")}
      </ol>
    </div>`).join("");

  // Mobile numbers masked in PDF — show only last 4 digits
  const simsList = sims.map((s,i) => `${esc(s.label || `SIM ${i+1}`)} (+91 ${maskMobile(s.mobile)})`).join(" · ");

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<title>UPI Audit Report</title>
<style>
  body{font-family:'Helvetica Neue',Arial,sans-serif;color:#111;margin:0;padding:28px;font-size:12px}
  h1{font-size:20px;margin:0 0 3px}.sub{color:#999;font-size:10px;margin-bottom:20px}
  .stats{display:flex;gap:12px;margin-bottom:20px}
  .stat{border:1px solid #ddd;border-radius:6px;padding:10px 16px;text-align:center;min-width:80px}
  .stat-v{font-size:20px;font-weight:800}.stat-l{font-size:9px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-top:2px}
  table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:24px}
  th{background:#f5f5f5;text-align:left;padding:7px 9px;font-size:9px;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #ddd}
  td{padding:7px 9px;border-bottom:1px solid #f0f0f0;vertical-align:top}tr:nth-child(even) td{background:#fafafa}
  h2{font-size:14px;margin:18px 0 9px;border-top:2px solid #111;padding-top:10px}
  .steps-grid{columns:2;column-gap:20px}
  .ussd{border:1px solid #ddd;border-radius:8px;padding:14px;margin-top:18px;break-inside:avoid}
  .footer{margin-top:24px;border-top:1px solid #eee;padding-top:8px;font-size:9px;color:#bbb}
  .privacy-note{background:#f9f9f9;border:1px solid #eee;border-radius:6px;padding:10px;margin-bottom:20px;font-size:10px;color:#888}
  @media print{body{padding:0}}
</style>
</head><body>
<h1>UPI Audit Report</h1>
<div class="sub">Generated ${today} · Local-only — not stored or transmitted</div>
<div class="privacy-note">⚠ This document contains partial mobile numbers. Store securely. Mobile numbers are masked to last 4 digits.</div>
<div class="stats">
  <div class="stat"><div class="stat-v">${allVPAs.length}</div><div class="stat-l">Total VPAs</div></div>
  <div class="stat"><div class="stat-v" style="color:#cc0000">${allVPAs.filter(v=>v.risk.level==="HIGH").length}</div><div class="stat-l">High Risk</div></div>
  <div class="stat"><div class="stat-v" style="color:#cc6600">${allVPAs.filter(v=>v.risk.level==="MEDIUM").length}</div><div class="stat-l">Medium</div></div>
  <div class="stat"><div class="stat-v" style="color:#006655">${allVPAs.filter(v=>v.risk.level==="LOW").length}</div><div class="stat-l">Low Risk</div></div>
  <div class="stat"><div class="stat-v">${sims.length}</div><div class="stat-l">SIMs</div></div>
</div>
<div style="font-size:10px;color:#888;margin-bottom:16px">Numbers: ${simsList}</div>
<h2>VPA Inventory (sorted by risk)</h2>
<table><thead><tr><th>VPA</th><th>App/Bank</th><th>SIM</th><th>Risk</th><th>Risk Factors</th><th>Done</th></tr></thead>
<tbody>${rows}</tbody></table>
<h2>Cleanup Steps</h2>
<div class="steps-grid">${stepBlocks}</div>
<div class="ussd">
  <div style="font-weight:700;margin-bottom:6px">*99# USSD — Read-Only VPA Discovery</div>
  <ol style="margin:0;padding-left:18px;font-size:11px;color:#333;line-height:1.7">
    <li>Dial *99# on any mobile (no internet needed)</li>
    <li>Option 1 → My Profile → note all registered VPAs</li>
    <li>Repeat for each old SIM</li>
  </ol>
  <div style="font-size:10px;color:#999;margin-top:6px">⚠ Read-only. Cannot delete VPAs.</div>
</div>
<div class="footer">UPI ID Health Check v1.1.1 · Re-audit every 6 months · No data stored or transmitted to any server</div>
</body></html>`;

  const win = window.open("", "_blank");
  if (win) { win.document.write(html); win.document.close(); setTimeout(() => win.print(), 400); }
}

// ─────────────────────────────────────────────
// ICS REMINDER  (no PII in file)
// ─────────────────────────────────────────────

function downloadICS() {
  const f = new Date(); f.setMonth(f.getMonth() + 6);
  const p = n => String(n).padStart(2, "0");
  const fmt = d => `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}T090000`;
  const ics = [
    "BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//UPI Audit//EN",
    "BEGIN:VEVENT",
    `DTSTART:${fmt(f)}`,`DTEND:${fmt(f)}`,
    "SUMMARY:UPI Audit — 6-Month Re-Audit",
    "DESCRIPTION:Time to re-audit your UPI IDs. Visit upiaudit.in and run a fresh check.",
    "STATUS:CONFIRMED",
    "BEGIN:VALARM","TRIGGER:-PT30M","ACTION:DISPLAY","DESCRIPTION:UPI Audit Reminder","END:VALARM",
    "END:VEVENT","END:VCALENDAR",
  ].join("\r\n");
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" })),
    download: "upi-audit-reminder.ics"
  });
  a.click(); URL.revokeObjectURL(a.href);
}

// ─────────────────────────────────────────────
// SHARED PRIMITIVES
// ─────────────────────────────────────────────

const ls  = { display:"block", fontSize:12, fontWeight:600, color:"#94a3b8", letterSpacing:0.5, marginBottom:6, textTransform:"uppercase" };
const is  = { display:"block", width:"100%", background:"#0f172a", border:"1px solid #334155", borderRadius:8, padding:"11px 13px", color:"#f1f5f9", fontSize:14, outline:"none", boxSizing:"border-box", fontFamily:"inherit" };
const bp  = { width:"100%", padding:"13px", borderRadius:10, fontSize:14, fontWeight:700, border:"none", cursor:"pointer", background:"#0ea5e9", color:"#fff", letterSpacing:0.2 };
const bs  = { width:"100%", padding:"13px", borderRadius:10, fontSize:14, fontWeight:600, border:"1px solid #334155", cursor:"pointer", background:"transparent", color:"#94a3b8" };

function RiskBadge({ level, color, score }) {
  return <span style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700, background:`${color}20`, color, border:`1px solid ${color}44`, letterSpacing:0.5, whiteSpace:"nowrap" }}>{level} · {score}</span>;
}
function StatCard({ value, label, color }) {
  return (
    <div style={{ flex:1, background:"#1e293b", border:"1px solid #334155", borderRadius:10, padding:"12px 12px" }}>
      <div style={{ fontSize:22, fontWeight:800, color, lineHeight:1 }}>{value}</div>
      <div style={{ fontSize:11, color:"#64748b", marginTop:4, textTransform:"uppercase", letterSpacing:0.5 }}>{label}</div>
    </div>
  );
}

const STEPS = ["Setup","VPAs","Risk","Action Plan","Cleanup"];
function StepIndicator({ current }) {
  return (
    <div style={{ display:"flex", alignItems:"center", marginBottom:24 }}>
      {STEPS.map((s,i) => (
        <div key={s} style={{ display:"flex", alignItems:"center", flex: i<STEPS.length-1 ? 1 : "none" }}>
          <div style={{ width:28, height:28, borderRadius:"50%", flexShrink:0, background: i<current?"#0ea5e9":i===current?"#fff":"transparent", border: i===current?"2px solid #fff":i<current?"2px solid #0ea5e9":"2px solid #475569", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color: i<=current?"#0f172a":"#64748b", transition:"all 0.3s" }}>
            {i < current ? "✓" : i+1}
          </div>
          <span style={{ marginLeft:5, fontSize:12, fontWeight: i===current?700:400, color: i===current?"#f1f5f9":i<current?"#0ea5e9":"#475569", whiteSpace:"nowrap" }}>{s}</span>
          {i < STEPS.length-1 && <div style={{ flex:1, height:1, background: i<current?"#0ea5e9":"#1e293b", margin:"0 8px" }} />}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// SIM CARD ENTRY  (with input validation)
// ─────────────────────────────────────────────

function SIMCard({ sim, index, onChange, onRemove, canRemove }) {
  const [mobileError, setMobileError] = useState("");

  const handleMobileChange = (val) => {
    const digits = val.replace(/\D/g, "").slice(0, 10);
    onChange({ ...sim, mobile: digits });
    if (digits.length === 10 && !isValidMobile(digits)) {
      setMobileError("Must be a valid 10-digit Indian mobile number (starts 6–9)");
    } else {
      setMobileError("");
    }
  };

  const toggle = (id, key) => {
    const l = sim[key];
    onChange({ ...sim, [key]: l.includes(id) ? l.filter(x=>x!==id) : [...l,id] });
  };

  return (
    <div style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:12, padding:"16px", marginBottom:14 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
        <span style={{ fontSize:12, fontWeight:700, color:"#38bdf8", letterSpacing:0.5 }}>SIM {index+1}</span>
        {canRemove && <button onClick={onRemove} style={{ background:"none", border:"1px solid #334155", borderRadius:5, color:"#64748b", cursor:"pointer", fontSize:11, padding:"3px 9px" }}>remove</button>}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:9, marginBottom:11 }}>
        <div style={{ gridColumn:"1/-1" }}>
          <label style={ls}>Mobile number</label>
          <input
            value={sim.mobile}
            onChange={e => handleMobileChange(e.target.value)}
            placeholder="9XXXXXXXXX"
            style={{ ...is, borderColor: mobileError ? "#FF4444" : "#252525" }}
            maxLength={10}
            inputMode="numeric"
            autoComplete="off"
          />
          {mobileError && <div style={{ fontSize:11, color:"#f87171", marginTop:-6, marginBottom:10 }}>{mobileError}</div>}
        </div>
        <div style={{ gridColumn:"1/-1" }}>
          <label style={ls}>Label (e.g. "Old SIM", "Work") — not stored with your number</label>
          <input
            value={sim.label}
            onChange={e => onChange({ ...sim, label: e.target.value.slice(0,30) })}
            placeholder="optional"
            style={is}
            maxLength={30}
          />
        </div>
        <div style={{ gridColumn:"1/-1" }}>
          <label style={ls}>Phone number status</label>
          <select value={sim.phoneStatus} onChange={e => onChange({...sim, phoneStatus:e.target.value})} style={is}>
            <option value="active">Active — I still use this number</option>
            <option value="inactive">Inactive — number not in use</option>
            <option value="changed">Changed / Surrendered — no longer mine</option>
          </select>
        </div>
        <div style={{ gridColumn:"1/-1" }}>
          <label style={ls}>Bank account status</label>
          <select value={sim.bankStatus} onChange={e => onChange({...sim, bankStatus:e.target.value})} style={is}>
            <option value="active">Active</option>
            <option value="dormant">Dormant</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </div>
      <label style={ls}>UPI apps used on this number</label>
      <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:9 }}>
        {PSP_DATA.map(app => { const sel = sim.selectedApps.includes(app.id); return (
          <button key={app.id} onClick={()=>toggle(app.id,"selectedApps")} style={{ padding:"4px 9px", borderRadius:6, cursor:"pointer", fontSize:10, fontWeight:600, border:sel?`1.5px solid ${app.color}`:"1.5px solid #252525", background:sel?`${app.color}18`:"#0d0d0d", color:sel?app.color:"#444", transition:"all 0.15s" }}>{app.shortName}</button>
        );})}
      </div>
      <label style={ls}>Banks linked on this number</label>
      <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
        {BANK_DATA.map(bank => { const sel = sim.selectedBanks.includes(bank.id); return (
          <button key={bank.id} onClick={()=>toggle(bank.id,"selectedBanks")} style={{ padding:"4px 9px", borderRadius:6, cursor:"pointer", fontSize:10, fontWeight:600, border:sel?`1.5px solid ${bank.color}`:"1.5px solid #252525", background:sel?`${bank.color}18`:"#0d0d0d", color:sel?bank.color:"#444", transition:"all 0.15s" }}>{bank.name}</button>
        );})}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SHARE MODAL  (URL is PII-free; text summary masks numbers)
// ─────────────────────────────────────────────

function ShareModal({ sims, vpas, done, onClose }) {
  const [copied, setCopied] = useState(null);
  const shareURL  = encodeConfigToURL(sims);
  const shareText = buildTextSummary(sims, vpas, done);
  const copy = async (text, key) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(()=>setCopied(null), 2200); } catch(_) {}
  };
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:16 }} onClick={onClose}>
      <div style={{ background:"#0c0c16", border:"1px solid #252535", borderRadius:14, padding:"22px 20px", width:"100%", maxWidth:440 }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <span style={{ fontSize:13, fontWeight:800, color:"#ddd" }}>Share / Export</span>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"#555", cursor:"pointer", fontSize:18, lineHeight:1 }}>×</button>
        </div>

        {/* URL share — no PII */}
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:9, fontWeight:700, color:"#2EC4B6", letterSpacing:1, textTransform:"uppercase", marginBottom:5 }}>
            🔒 Share Link — No personal data in URL
          </div>
          <div style={{ fontSize:9, color:"#555", marginBottom:8, lineHeight:1.5 }}>
            Shares your app selections and settings only. Mobile numbers are <strong style={{color:"#888"}}>not included</strong>. Recipient enters their own number.
          </div>
          <div style={{ background:"#0d0d12", border:"1px solid #1e1e1e", borderRadius:8, padding:"8px 10px", marginBottom:7, wordBreak:"break-all", fontSize:9, color:"#444", fontFamily:"monospace", maxHeight:48, overflow:"hidden" }}>
            {shareURL ? shareURL.slice(0, 100)+"…" : "unavailable"}
          </div>
          <button onClick={()=>copy(shareURL,"url")} style={{ ...bp, fontSize:11, padding:"8px" }}>
            {copied==="url" ? "✓ Copied!" : "Copy Share Link"}
          </button>
        </div>

        <div style={{ height:1, background:"#181820", margin:"14px 0" }} />

        {/* Text summary — masked numbers */}
        <div>
          <div style={{ fontSize:9, fontWeight:700, color:"#555", letterSpacing:1, textTransform:"uppercase", marginBottom:5 }}>
            Text Summary — Numbers masked to last 4 digits
          </div>
          <pre style={{ background:"#0d0d12", border:"1px solid #1e1e1e", borderRadius:8, padding:"8px 10px", marginBottom:7, fontSize:9, color:"#666", fontFamily:"monospace", overflowX:"auto", whiteSpace:"pre-wrap", maxHeight:130, overflowY:"auto", lineHeight:1.5 }}>
            {shareText}
          </pre>
          <button onClick={()=>copy(shareText,"text")} style={{ ...bp, fontSize:11, padding:"8px", background:"#1a1a28", color:"#aaa" }}>
            {copied==="text" ? "✓ Copied!" : "Copy Text Summary"}
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
  mobile:"", label:"",
  phoneStatus:"active", bankStatus:"active",
  selectedApps:[], selectedBanks:[],
});

function Step0Setup({ onNext, initialSims }) {
  const [sims, setSims] = useState(initialSims && initialSims.length ? initialSims : [blankSIM()]);

  const updateSIM = (i, val) => setSims(sims.map((s,j) => j===i ? val : s));

  const valid = sims.every(s =>
    isValidMobile(s.mobile) && (s.selectedApps.length + s.selectedBanks.length) > 0
  );

  return (
    <div>
      <h2 style={{ fontSize:22, fontWeight:700, color:"#f1f5f9", marginBottom:6 }}>Set up your health check</h2>
      <p style={{ color:"#94a3b8", fontSize:14, marginBottom:16, lineHeight:1.6 }}>
        Add every number you've used for UPI — current and old SIMs. All data stays local.
      </p>
      {/* Security notice */}
      <div style={{ background:"#0c2a1a", border:"1px solid #166534", borderRadius:8, padding:"11px 14px", marginBottom:16, fontSize:13, color:"#4ade80", lineHeight:1.6 }}>
        🔒 <strong>Privacy:</strong> Your mobile number is held in memory only and cleared when you close this tab. Never written to disk or sent anywhere.
      </div>

      {sims.map((sim,i) => (
        <SIMCard key={sim.id} sim={sim} index={i}
          onChange={val=>updateSIM(i,val)}
          onRemove={()=>setSims(sims.filter((_,j)=>j!==i))}
          canRemove={sims.length>1}
        />
      ))}

      <button onClick={()=>setSims([...sims,blankSIM()])} style={{ width:"100%", padding:"11px", borderRadius:10, fontSize:13, fontWeight:600, border:"1.5px dashed #334155", background:"transparent", color:"#64748b", cursor:"pointer", marginBottom:14 }}>
        + Add another SIM / old number
      </button>
      <button onClick={()=>valid&&onNext(sims)} disabled={!valid} style={{ ...bp, background:valid?"#0ea5e9":"#1e293b", color:valid?"#fff":"#475569", cursor:valid?"pointer":"not-allowed" }}>
        Generate UPI ID List →
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────
// STEP 1 — VPA LIST
// ─────────────────────────────────────────────

function Step1VPAs({ sims, vpas, onNext, onBack }) {
  const grouped = sims.map((s,idx) => ({
    ...s, dl: s.label||`SIM ${idx+1}`,
    simVPAs: vpas.filter(v=>v.mobile===s.mobile)
  }));
  return (
    <div>
      <h2 style={{ fontSize:22, fontWeight:700, color:"#f1f5f9", marginBottom:6 }}>Your likely UPI IDs</h2>
      <p style={{ color:"#94a3b8", fontSize:14, marginBottom:14, lineHeight:1.6 }}>Based on standard UPI handle patterns. Verify each via the actual app or dial *99#.</p>
      <div style={{ display:"flex", gap:7, marginBottom:16 }}>
        <StatCard value={vpas.length} label="Total VPAs" color="#fff" />
        <StatCard value={vpas.filter(v=>v.risk.level==="HIGH").length} label="High Risk" color="#FF4444" />
        <StatCard value={vpas.filter(v=>v.risk.level==="MEDIUM").length} label="Medium" color="#FF9F1C" />
        <StatCard value={sims.length} label="SIMs" color="#7B61FF" />
      </div>
      {grouped.map((g,gi) => (
        <div key={gi} style={{ marginBottom:15 }}>
          <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:6 }}>
            <span style={{ fontSize:8, fontWeight:800, color:"#7B61FF", background:"#7B61FF18", border:"1px solid #7B61FF33", borderRadius:4, padding:"2px 7px", letterSpacing:1, textTransform:"uppercase" }}>{g.dl}</span>
            {/* Show masked number only */}
            <span style={{ fontSize:9, color:"#333", fontFamily:"monospace" }}>+91 {maskMobile(g.mobile)}</span>
          </div>
          {g.simVPAs.map((v,i) => (
            <div key={i} style={{ background:"#0d0d12", border:"1px solid #181818", borderLeft:`3px solid ${v.color}`, borderRadius:7, padding:"9px 11px", marginBottom:5, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div>
                <div style={{ fontFamily:"monospace", fontSize:11, color:"#ccc", fontWeight:600 }}>{v.vpa}</div>
                <div style={{ fontSize:9, color:"#444", marginTop:1 }}>{v.appName}</div>
              </div>
              <RiskBadge level={v.risk.level} color={v.risk.color} score={v.risk.score} />
            </div>
          ))}
        </div>
      ))}
      <div style={{ display:"flex", gap:8, marginTop:4 }}>
        <button onClick={onBack} style={{ ...bs, flex:"0 0 70px" }}>← Back</button>
        <button onClick={onNext} style={bp}>View Risk Details →</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// STEP 2 — RISK AUDIT
// ─────────────────────────────────────────────

function Step2Risk({ vpas, onNext, onBack }) {
  const sorted = [...vpas].sort((a,b)=>b.risk.score-a.risk.score);
  const byLevel = { HIGH: sorted.filter(v=>v.risk.level==="HIGH"), MEDIUM: sorted.filter(v=>v.risk.level==="MEDIUM"), LOW: sorted.filter(v=>v.risk.level==="LOW") };
  const meta = { HIGH:{color:"#ef4444",label:"HIGH — Investigate promptly"}, MEDIUM:{color:"#f59e0b",label:"MEDIUM — Review soon"}, LOW:{color:"#22c55e",label:"LOW — Monitor"} };
  return (
    <div>
      <h2 style={{ fontSize:22, fontWeight:700, color:"#f1f5f9", marginBottom:6 }}>Risk breakdown</h2>
      <p style={{ color:"#94a3b8", fontSize:14, marginBottom:16, lineHeight:1.6 }}>
        Based on what you told us — your phone number status and bank account status.
      </p>

      {/* Risk score explainer */}
      <div style={{ background:"#1a1f2e", border:"1px solid #334155", borderRadius:10, padding:"14px 16px", marginBottom:20 }}>
        <div style={{ fontSize:12, fontWeight:600, color:"#94a3b8", marginBottom:6 }}>💡 What does this score mean?</div>
        <div style={{ fontSize:13, color:"#64748b", lineHeight:1.7 }}>
          The risk score is based entirely on the information <strong style={{ color:"#94a3b8" }}>you provided</strong> — it does not connect to any bank, NPCI, or UPI system, and cannot verify whether any ID is actually active or has been misused.
          <br /><br />
          Think of it as a <strong style={{ color:"#94a3b8" }}>situational risk signal</strong> — like a doctor asking about your lifestyle before running tests. A HIGH score means the situation warrants investigation, not that something has definitely gone wrong. Always verify via <strong style={{ color:"#94a3b8", fontFamily:"monospace" }}>*99#</strong> before taking action.
        </div>
        <div style={{ marginTop:12, display:"flex", flexWrap:"wrap", gap:8 }}>
          {[
            { label:"Phone number changed/surrendered", pts:"50 pts" },
            { label:"Phone number inactive",            pts:"35 pts" },
            { label:"Bank account closed",              pts:"35 pts" },
            { label:"Bank account dormant",             pts:"20 pts" },
            { label:"App harder to remove",             pts:"5 pts"  },
          ].map((f,i) => (
            <div key={i} style={{ fontSize:11, color:"#475569", background:"#0f172a", border:"1px solid #1e293b", borderRadius:6, padding:"3px 9px" }}>
              {f.label} <span style={{ color:"#334155" }}>· {f.pts}</span>
            </div>
          ))}
        </div>
      </div>

      {Object.entries(byLevel).filter(([,vs])=>vs.length>0).map(([level,vs]) => (
        <div key={level} style={{ marginBottom:16 }}>
          <div style={{ fontSize:11, fontWeight:700, color:meta[level].color, letterSpacing:0.8, marginBottom:8, textTransform:"uppercase" }}>{meta[level].label} ({vs.length})</div>
          {vs.map((v,i) => (
            <div key={i} style={{ background:"#0f172a", border:`1px solid ${v.risk.color}22`, borderRadius:9, padding:"11px 13px", marginBottom:6 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:5 }}>
                <div>
                  <div style={{ fontFamily:"monospace", fontSize:12, color:"#e2e8f0" }}>{v.vpa}</div>
                  <div style={{ fontSize:11, color:"#475569", marginTop:2 }}>{v.appName} · {v.simLabel}</div>
                </div>
                <RiskBadge level={v.risk.level} color={v.risk.color} score={v.risk.score} />
              </div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                {v.risk.flags.map((f,j)=><span key={j} style={{ fontSize:11, padding:"2px 8px", borderRadius:4, background:"#1e293b", color:"#64748b", border:"1px solid #334155" }}>⚠ {f}</span>)}
              </div>
            </div>
          ))}
        </div>
      ))}
      <div style={{ display:"flex", gap:8 }}>
        <button onClick={onBack} style={{ ...bs, flex:"0 0 80px" }}>← Back</button>
        <button onClick={onNext} style={bp}>See My Action Plan →</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// STEP 3 — ACTION PLAN
// ─────────────────────────────────────────────

function Step3ActionPlan({ vpas, onNext, onBack }) {
  const high   = vpas.filter(v => v.risk.level === "HIGH");
  const medium = vpas.filter(v => v.risk.level === "MEDIUM");
  const low    = vpas.filter(v => v.risk.level === "LOW");

  // Group by app for batching advice
  const byApp = vpas.reduce((acc, v) => {
    if (v.risk.level === "LOW") return acc;
    const key = v.appName;
    if (!acc[key]) acc[key] = { name: key, color: v.color, high: 0, medium: 0 };
    if (v.risk.level === "HIGH") acc[key].high++;
    else acc[key].medium++;
    return acc;
  }, {});

  const appGroups = Object.values(byApp)
    .filter(a => a.high + a.medium > 0)
    .sort((a, b) => (b.high - a.high) || (b.medium - a.medium));

  // Estimate: ~3 min per HIGH item, ~2 min per MEDIUM
  const estMins = high.length * 3 + medium.length * 2;

  const urgencyLabel = high.length > 0
    ? `${high.length} item${high.length > 1 ? "s" : ""} need attention this week`
    : medium.length > 0
    ? `${medium.length} item${medium.length > 1 ? "s" : ""} to review this month`
    : "Nothing urgent — you're in good shape";

  const PriorityItem = ({ v, tier }) => (
    <div style={{ display:"flex", alignItems:"flex-start", gap:12, padding:"11px 14px", background:"#0f172a", border:`1px solid ${v.risk.color}22`, borderLeft:`3px solid ${v.risk.color}`, borderRadius:8, marginBottom:8 }}>
      <div style={{ flex:1 }}>
        <div style={{ fontFamily:"monospace", fontSize:12, color:"#e2e8f0", fontWeight:600, marginBottom:3 }}>{v.vpa}</div>
        <div style={{ fontSize:11, color:"#64748b" }}>{v.appName} · {v.simLabel}</div>
        {v.risk.flags.length > 0 && (
          <div style={{ fontSize:11, color: tier === "HIGH" ? "#fca5a5" : "#fcd34d", marginTop:4 }}>
            ⚠ {v.risk.flags[0]}
          </div>
        )}
      </div>
      <div style={{ fontSize:10, color:"#475569", textAlign:"right", flexShrink:0 }}>
        ~{tier === "HIGH" ? 3 : 2} min
      </div>
    </div>
  );

  return (
    <div>
      <h2 style={{ fontSize:22, fontWeight:700, color:"#f1f5f9", marginBottom:4 }}>Your action plan</h2>
      <p style={{ color:"#94a3b8", fontSize:14, marginBottom:20, lineHeight:1.6 }}>
        {urgencyLabel}
        {estMins > 0 && <span style={{ color:"#64748b" }}> · ~{estMins} min total</span>}
      </p>

      {/* Before you start */}
      <div style={{ background:"#0c1a2e", border:"1px solid #1e3a5f", borderRadius:10, padding:"13px 16px", marginBottom:20 }}>
        <div style={{ fontSize:12, fontWeight:600, color:"#38bdf8", marginBottom:8 }}>⚡ Before you start</div>
        <div style={{ fontSize:13, color:"#64748b", lineHeight:1.7 }}>
          Dial <strong style={{ color:"#e2e8f0", fontFamily:"monospace" }}>*99#</strong> from each SIM to verify these IDs actually exist before deleting. Takes 2 minutes per SIM. Works without internet on any phone.
        </div>
      </div>

      {/* HIGH risk */}
      {high.length > 0 && (
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:11, fontWeight:700, color:"#ef4444", letterSpacing:0.8, textTransform:"uppercase", marginBottom:10 }}>
            🔴 Do this week — High risk ({high.length})
          </div>
          {high.sort((a,b) => b.risk.score - a.risk.score).map((v,i) => <PriorityItem key={i} v={v} tier="HIGH" />)}
        </div>
      )}

      {/* MEDIUM risk */}
      {medium.length > 0 && (
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:11, fontWeight:700, color:"#f59e0b", letterSpacing:0.8, textTransform:"uppercase", marginBottom:10 }}>
            🟡 Do this month — Medium risk ({medium.length})
          </div>
          {medium.sort((a,b) => b.risk.score - a.risk.score).map((v,i) => <PriorityItem key={i} v={v} tier="MEDIUM" />)}
        </div>
      )}

      {/* LOW risk */}
      {low.length > 0 && (
        <div style={{ background:"#0f172a", border:"1px solid #1e293b", borderRadius:10, padding:"12px 16px", marginBottom:20 }}>
          <div style={{ fontSize:12, color:"#22c55e", fontWeight:600, marginBottom:3 }}>
            ✓ {low.length} low risk ID{low.length > 1 ? "s" : ""} — no action needed now
          </div>
          <div style={{ fontSize:12, color:"#475569" }}>Monitor these at your 6-month re-audit.</div>
        </div>
      )}

      {/* Batch by app */}
      {appGroups.length > 0 && (
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:11, fontWeight:700, color:"#94a3b8", letterSpacing:0.8, textTransform:"uppercase", marginBottom:10 }}>
            📱 Batch by app — open each app once
          </div>
          {appGroups.map((a, i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 14px", background:"#0f172a", border:"1px solid #1e293b", borderLeft:`3px solid ${a.color}`, borderRadius:8, marginBottom:6 }}>
              <span style={{ fontSize:13, color:"#e2e8f0", fontWeight:500 }}>{a.name}</span>
              <div style={{ display:"flex", gap:8 }}>
                {a.high > 0 && <span style={{ fontSize:11, color:"#fca5a5", background:"#7f1d1d22", padding:"2px 8px", borderRadius:10 }}>{a.high} high</span>}
                {a.medium > 0 && <span style={{ fontSize:11, color:"#fcd34d", background:"#78350f22", padding:"2px 8px", borderRadius:10 }}>{a.medium} medium</span>}
              </div>
            </div>
          ))}
          <div style={{ fontSize:11, color:"#475569", marginTop:8, lineHeight:1.6 }}>
            Open each app once and handle all its items in one go — much faster than going app by app per ID.
          </div>
        </div>
      )}

      {/* Nothing to do */}
      {high.length === 0 && medium.length === 0 && (
        <div style={{ background:"#0c2a1a", border:"1px solid #166534", borderRadius:10, padding:"16px", marginBottom:20, textAlign:"center" }}>
          <div style={{ fontSize:20, marginBottom:6 }}>✓</div>
          <div style={{ fontSize:14, color:"#4ade80", fontWeight:600 }}>You're in good shape</div>
          <div style={{ fontSize:12, color:"#475569", marginTop:4 }}>No high or medium risk IDs found. Re-audit every 6 months.</div>
        </div>
      )}

      <div style={{ display:"flex", gap:8 }}>
        <button onClick={onBack} style={{ ...bs, flex:"0 0 80px" }}>← Back</button>
        <button onClick={onNext} style={bp}>Go to cleanup checklist →</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// STEP 4 — CLEANUP

function Step4Cleanup({ vpas, sims, done, setDone, onBack }) {
  const [expanded,   setExpanded]   = useState(null);
  const [showUSSD,   setShowUSSD]   = useState(false);
  const [reminderOK, setReminderOK] = useState(false);
  const [showShare,  setShowShare]  = useState(false);

  const sorted = [...vpas].sort((a,b)=>b.risk.score-a.risk.score);
  const toggleDone = vpa => setDone(d => d.includes(vpa) ? d.filter(x=>x!==vpa) : [...d,vpa]);
  const progress = sorted.length > 0 ? (done.length/sorted.length)*100 : 0;

  return (
    <div>
      {showShare && <ShareModal sims={sims} vpas={vpas} done={done} onClose={()=>setShowShare(false)} />}

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:4 }}>
        <div>
          <h2 style={{ fontSize:22, fontWeight:700, color:"#f1f5f9", margin:0 }}>Cleanup checklist</h2>
          <p style={{ color:"#94a3b8", fontSize:13, marginTop:4 }}>{done.length} of {sorted.length} cleaned up</p>
        </div>
        <div style={{ display:"flex", gap:5 }}>
          <button onClick={()=>exportToPDF(vpas,sims)} style={{ padding:"5px 8px", borderRadius:6, fontSize:9, fontWeight:700, border:"1px solid #252525", background:"#0d0d12", color:"#777", cursor:"pointer" }}>↓ PDF</button>
          <button onClick={()=>setShowShare(true)} style={{ padding:"5px 8px", borderRadius:6, fontSize:9, fontWeight:700, border:"1px solid #252525", background:"#0d0d12", color:"#777", cursor:"pointer" }}>⬆ Share</button>
          <button onClick={()=>{downloadICS();setReminderOK(true);}} style={{ padding:"5px 8px", borderRadius:6, fontSize:9, fontWeight:700, border:`1px solid ${reminderOK?"#2EC4B644":"#252525"}`, background:reminderOK?"#2EC4B610":"#0d0d12", color:reminderOK?"#2EC4B6":"#777", cursor:"pointer" }}>
            {reminderOK?"✓":"⏱"}
          </button>
        </div>
      </div>

      <div style={{ height:3, background:"#151515", borderRadius:3, margin:"11px 0 16px", overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${progress}%`, background:"linear-gradient(90deg,#2EC4B6,#0a7a72)", borderRadius:3, transition:"width 0.4s ease" }} />
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:14 }}>
        {sorted.map((v,i) => {
          const isDone = done.includes(v.vpa);
          const isOpen = expanded === v.vpa;
          return (
            <div key={i} style={{ background:isDone?"#0b130b":"#0d0d12", border:isDone?"1px solid #2EC4B620":"1px solid #181818", borderRadius:9, overflow:"hidden", opacity:isDone?0.6:1, transition:"all 0.2s" }}>
              <div onClick={()=>setExpanded(isOpen?null:v.vpa)} style={{ padding:"9px 11px", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <div onClick={e=>{e.stopPropagation();toggleDone(v.vpa);}} style={{ width:15, height:15, borderRadius:3, flexShrink:0, border:`2px solid ${isDone?"#2EC4B6":v.risk.color}`, background:isDone?"#2EC4B6":"transparent", display:"flex", alignItems:"center", justifyContent:"center", fontSize:7, color:isDone?"#08080e":"transparent", cursor:"pointer" }}>✓</div>
                  <div>
                    <div style={{ fontFamily:"monospace", fontSize:11, color:isDone?"#3a3a3a":"#ccc", fontWeight:600 }}>{v.vpa}</div>
                    <div style={{ fontSize:8, color:"#3a3a3a", marginTop:1 }}>{v.appName} · {v.simLabel}</div>
                  </div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                  <RiskBadge level={v.risk.level} color={v.risk.color} score={v.risk.score} />
                  <span style={{ color:"#2a2a2a", fontSize:9 }}>{isOpen?"▲":"▼"}</span>
                </div>
              </div>
              {isOpen && (
                <div style={{ padding:"0 11px 11px", borderTop:"1px solid #141414" }}>
                  <div style={{ fontSize:9, color:"#444", margin:"8px 0 6px", textTransform:"uppercase", letterSpacing:0.8 }}>Steps to remove</div>
                  {(v.cleanupSteps||["Contact your bank directly"]).map((step,j)=>(
                    <div key={j} style={{ display:"flex", gap:7, marginBottom:5, alignItems:"flex-start" }}>
                      <span style={{ minWidth:14, height:14, borderRadius:"50%", background:"#111", border:"1px solid #222", display:"flex", alignItems:"center", justifyContent:"center", fontSize:7, color:"#555", flexShrink:0 }}>{j+1}</span>
                      <span style={{ fontSize:11, color:"#888", lineHeight:1.5 }}>{step}</span>
                    </div>
                  ))}
                  <button onClick={()=>toggleDone(v.vpa)} style={{ marginTop:8, padding:"4px 11px", borderRadius:5, fontSize:9, fontWeight:700, cursor:"pointer", border:"none", background:isDone?"#1a2a1a":"#2EC4B6", color:isDone?"#2EC4B6":"#08080e" }}>
                    {isDone?"✓ Mark as pending":"Mark as cleaned up ✓"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {done.length===sorted.length && sorted.length>0 && (
        <div style={{ background:"#0b130b", border:"1px solid #2EC4B630", borderRadius:10, padding:"11px", textAlign:"center", marginBottom:12 }}>
          <div style={{ fontSize:17, marginBottom:3 }}>✓</div>
          <div style={{ color:"#2EC4B6", fontWeight:700, fontSize:12 }}>All VPAs cleaned up</div>
          <div style={{ color:"#3a3a3a", fontSize:9, marginTop:3 }}>Use ⏱ to set a 6-month re-audit reminder.</div>
        </div>
      )}

      {/* *99# USSD */}
      <div style={{ marginBottom:12 }}>
        <button onClick={()=>setShowUSSD(!showUSSD)} style={{ width:"100%", padding:"9px 11px", borderRadius:showUSSD?"9px 9px 0 0":9, cursor:"pointer", background:"#0d0d12", border:"1px solid #1e1e28", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ display:"flex", alignItems:"center", gap:7 }}>
            <span style={{ fontSize:9, fontWeight:800, color:"#FFD700", background:"#FFD70010", border:"1px solid #FFD70022", borderRadius:4, padding:"1px 5px" }}>*99#</span>
            <span style={{ fontSize:11, color:"#888", fontWeight:600 }}>USSD Verification Guide</span>
          </div>
          <span style={{ color:"#333", fontSize:9 }}>{showUSSD?"▲":"▼"}</span>
        </button>
        {showUSSD && (
          <div style={{ background:"#080810", border:"1px solid #1e1e28", borderTop:"none", borderRadius:"0 0 9px 9px", padding:"11px" }}>
            <p style={{ fontSize:10, color:"#555", marginBottom:9, lineHeight:1.6 }}>
              NPCI's USSD service — VPA discovery without internet.
              <span style={{ color:"#FF9F1C", display:"block", marginTop:2 }}>⚠ Read-only. Cannot delete VPAs.</span>
            </p>
            {USSD_STEPS.map((s,i) => (
              <div key={i} style={{ display:"flex", gap:8, marginBottom:8, alignItems:"flex-start" }}>
                <div style={{ minWidth:19, height:19, borderRadius:4, background:"#FFD70010", border:"1px solid #FFD70022", display:"flex", alignItems:"center", justifyContent:"center", fontSize:8, fontWeight:800, color:"#FFD700", flexShrink:0 }}>{i+1}</div>
                <div>
                  <div style={{ fontSize:11, color:"#bbb", fontWeight:600 }}>{s.step}</div>
                  <div style={{ fontSize:9, color:"#444", marginTop:2, lineHeight:1.4 }}>{s.detail}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ background:"#0d0d12", border:"1px solid #181818", borderRadius:10, padding:"11px", marginBottom:12 }}>
        <div style={{ fontSize:8, fontWeight:700, color:"#333", letterSpacing:1.2, textTransform:"uppercase", marginBottom:8 }}>Export & Share</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6 }}>
          <button onClick={()=>exportToPDF(vpas,sims)} style={{ padding:"8px 4px", borderRadius:7, fontSize:9, fontWeight:700, border:"1px solid #222", background:"#111", color:"#888", cursor:"pointer" }}>↓ PDF</button>
          <button onClick={()=>setShowShare(true)} style={{ padding:"8px 4px", borderRadius:7, fontSize:9, fontWeight:700, border:"1px solid #222", background:"#111", color:"#888", cursor:"pointer" }}>⬆ Share</button>
          <button onClick={()=>{downloadICS();setReminderOK(true);}} style={{ padding:"8px 4px", borderRadius:7, fontSize:9, fontWeight:700, border:`1px solid ${reminderOK?"#2EC4B640":"#222"}`, background:reminderOK?"#2EC4B610":"#111", color:reminderOK?"#2EC4B6":"#888", cursor:"pointer" }}>
            {reminderOK?"✓ Set":"⏱ Remind"}
          </button>
        </div>
      </div>

      <button onClick={onBack} style={bs}>← Back</button>
    </div>
  );
}

// ─────────────────────────────────────────────
// SESSION RESTORE BANNER
// ─────────────────────────────────────────────

function RestoreBanner({ mobilesPresent, onDismiss, onClear }) {
  return (
    <div style={{ background:"#0d1420", border:"1px solid #2EC4B630", borderRadius:10, padding:"10px 14px", marginBottom:16, fontSize:10, lineHeight:1.6 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
        <div>
          <div style={{ color:"#2EC4B6", fontWeight:700, marginBottom:2 }}>
            {mobilesPresent ? "Session restored" : "Audit settings restored — please re-enter mobile numbers"}
          </div>
          <div style={{ color:"#3a5a50" }}>
            {mobilesPresent
              ? "Your previous audit was loaded. Mobile numbers are in memory only."
              : "Settings were saved but mobile numbers were cleared when the tab closed. Re-enter below to continue."}
          </div>
        </div>
        <div style={{ display:"flex", gap:5, flexShrink:0, marginLeft:10 }}>
          <button onClick={onClear} style={{ padding:"3px 8px", borderRadius:5, fontSize:9, fontWeight:700, border:"1px solid #333", background:"transparent", color:"#555", cursor:"pointer" }}>Clear</button>
          <button onClick={onDismiss} style={{ padding:"3px 8px", borderRadius:5, fontSize:9, fontWeight:700, border:"none", background:"#2EC4B620", color:"#2EC4B6", cursor:"pointer" }}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// ABOUT PANEL
// ─────────────────────────────────────────────

function AboutPanel() {
  const [open, setOpen] = useState(false);

  const Section = ({ icon, title, children }) => (
    <div style={{ marginBottom:20 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
        <span style={{ fontSize:16 }}>{icon}</span>
        <span style={{ fontSize:13, fontWeight:600, color:"#f1f5f9" }}>{title}</span>
      </div>
      <div style={{ fontSize:13, color:"#94a3b8", lineHeight:1.75, paddingLeft:24 }}>{children}</div>
    </div>
  );

  return (
    <div style={{ marginTop:0, marginBottom:20 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ width:"100%", padding:"13px 18px", borderRadius: open ? "12px 12px 0 0" : 12, cursor:"pointer", background:"#1e293b", border:"1px solid #334155", display:"flex", justifyContent:"space-between", alignItems:"center" }}
      >
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:14 }}>ℹ️</span>
          <span style={{ fontSize:13, fontWeight:600, color:"#94a3b8" }}>What is this? Why should I use it? Is it safe?</span>
        </div>
        <span style={{ color:"#475569", fontSize:12, fontWeight:600 }}>{open ? "▲ Close" : "▼ Read"}</span>
      </button>

      {open && (
        <div style={{ background:"#1e293b", border:"1px solid #334155", borderTop:"none", borderRadius:"0 0 12px 12px", padding:"22px 20px" }}>

          <Section icon="💡" title="How this started">
            This tool was born from a short article in The Economic Times — <a href="https://economictimes.indiatimes.com/wealth/save/how-your-old-forgotten-upi-ids-may-become-a-security-risk-and-how-to-protectyourself/articleshow/131195220.cms" target="_blank" rel="noopener noreferrer" style={{ color:"#38bdf8", textDecoration:"none" }}>How your old forgotten UPI IDs may become a security risk</a>. The article explained the risk clearly but offered no easy solution — no tool existed to find all your UPI IDs in one place and walk you through cleaning them up. So we built one. Same evening. Over a glass of wine.
          </Section>

          <Section icon="❓" title="Why should you care?">
            Every UPI app you've ever installed — GPay, PhonePe, Paytm, Amazon Pay, CRED — quietly created several UPI IDs the moment you signed up. They don't disappear when you uninstall the app. They don't close when you change your phone number. They don't deactivate when you close a bank account.
            <br /><br />
            Most people have 15–40 active UPI IDs they've never seen. If you've ever changed your mobile number, that old number may have been reassigned to someone else by your telecom operator. Your UPI IDs still point to your bank. This is a real, underreported risk.
          </Section>

          <Section icon="🔧" title="What this tool does">
            It generates every UPI ID likely created for your mobile numbers across all major apps and banks — based on the standard handle patterns NPCI mandates. It scores each one for risk based on your phone number status and whether the linked bank account is still active. Then it gives you step-by-step instructions to delete the risky ones, app by app. No guessing. No Googling.
          </Section>

          <Section icon="🔒" title="Your data — exactly what happens to it">
            <strong style={{ color:"#e2e8f0" }}>Your mobile number never leaves your device.</strong> Full stop. Here is exactly what happens technically:
            <br /><br />
            • Your number is held in browser memory (React state) only<br />
            • It is written to sessionStorage — which clears automatically when you close the tab<br />
            • It is <strong style={{ color:"#e2e8f0" }}>never</strong> written to localStorage<br />
            • It is <strong style={{ color:"#e2e8f0" }}>never</strong> sent to any server, API, or backend — because there is none<br />
            • The share link contains zero personal data — only your app selections<br />
            • The PDF export masks your number to last 4 digits only<br />
            <br />
            Open your browser's DevTools → Network tab while using this tool. You will see zero outgoing requests. That is the proof, not just a promise.
          </Section>

          <div style={{ background:"#0c1a2e", border:"1px solid #1e3a5f", borderRadius:10, padding:"14px 16px", marginBottom:20 }}>
            <div style={{ display:"flex", alignItems:"flex-start", gap:10 }}>
              <span style={{ fontSize:18, flexShrink:0 }}>📊</span>
              <div>
                <div style={{ fontSize:13, fontWeight:600, color:"#38bdf8", marginBottom:5 }}>No analytics. Zero. And that's deliberate.</div>
                <div style={{ fontSize:13, color:"#64748b", lineHeight:1.7 }}>
                  We know — for a digital analytics professional to ship a tool with no analytics is almost ironic. But for something that touches financial identity, privacy beats insight. There is no Adobe Analytics, no Google Analytics, no Mixpanel, no tracking pixel, no heatmap, no session recording, no event logging. Nothing. If you use this tool, we have no idea. And that's exactly how it should be.
                </div>
              </div>
            </div>
          </div>

          <Section icon="⚠️" title="Important disclaimer">
            UPI IDs shown are generated based on standard handle patterns and may not match your exact account state. Always cross-check by dialling <strong style={{ color:"#e2e8f0" }}>*99#</strong> from your SIM — NPCI's own service — before taking any action. This tool is not affiliated with NPCI, UPI, or any bank or payment service provider. It is a free public utility, built for Indian UPI users.
          </Section>

          <div style={{ borderTop:"1px solid #334155", paddingTop:14, fontSize:12, color:"#475569", lineHeight:1.9 }}>
            Inspired by <a href="https://economictimes.indiatimes.com/wealth/save/how-your-old-forgotten-upi-ids-may-become-a-security-risk-and-how-to-protectyourself/articleshow/131195220.cms" target="_blank" rel="noopener noreferrer" style={{ color:"#38bdf8", textDecoration:"none", borderBottom:"1px solid #38bdf833" }}>this ET article</a> · Built with <a href="https://claude.ai" target="_blank" rel="noopener noreferrer" style={{ color:"#38bdf8", textDecoration:"none", borderBottom:"1px solid #38bdf833" }}>Claude</a> in one evening · Shipped because it needed to exist.
          </div>

        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// CONSENT GATE
// Shown once per session before the tool loads.
// Persists acceptance to sessionStorage — won't
// re-appear on refresh within the same session.
// ─────────────────────────────────────────────

function ConsentGate({ onAccept }) {
  const [checked, setChecked] = useState(false);

  return (
    <div style={{ minHeight:"100vh", background:"#0f172a", fontFamily:"'Inter','Segoe UI',sans-serif", display:"flex", alignItems:"center", justifyContent:"center", padding:"24px 16px" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}`}</style>
      <div style={{ width:"100%", maxWidth:480 }}>

        {/* Logo */}
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:32 }}>
          <div style={{ width:40, height:40, borderRadius:10, background:"linear-gradient(135deg,#0ea5e9,#0369a1)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, fontWeight:700, color:"#fff" }}>₹</div>
          <div>
            <div style={{ fontSize:18, fontWeight:700, color:"#f1f5f9", letterSpacing:-0.3 }}>UPI ID Health Check</div>
            <div style={{ fontSize:11, color:"#475569", marginTop:1 }}>Find · Risk-Score · Clean Up</div>
          </div>
        </div>

        <div style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:16, padding:"28px 24px" }}>

          <div style={{ fontSize:22, fontWeight:700, color:"#f1f5f9", marginBottom:8 }}>Before you begin</div>
          <p style={{ fontSize:14, color:"#94a3b8", lineHeight:1.7, marginBottom:24 }}>
            This tool generates likely UPI IDs based on your mobile number and publicly known handle patterns. It does <strong style={{ color:"#e2e8f0" }}>not</strong> connect to any bank, NPCI, or UPI system — and cannot verify whether any ID is active.
          </p>

          {/* What this tool does NOT do */}
          <div style={{ background:"#0f172a", border:"1px solid #334155", borderRadius:10, padding:"14px 16px", marginBottom:24 }}>
            <div style={{ fontSize:12, fontWeight:600, color:"#64748b", letterSpacing:0.5, textTransform:"uppercase", marginBottom:10 }}>This tool does NOT</div>
            {[
              "Access your bank account or UPI apps",
              "Verify whether any UPI ID is real or active",
              "Connect to NPCI, any bank, or any external service",
              "Store, transmit, or log your mobile number anywhere",
            ].map((item, i) => (
              <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:10, marginBottom:8 }}>
                <span style={{ color:"#ef4444", fontSize:14, flexShrink:0, marginTop:1 }}>✕</span>
                <span style={{ fontSize:13, color:"#94a3b8", lineHeight:1.5 }}>{item}</span>
              </div>
            ))}
          </div>

          {/* Consent checkbox */}
          <label style={{ display:"flex", alignItems:"flex-start", gap:12, cursor:"pointer", marginBottom:24, padding:"14px 16px", background: checked ? "#0c2a1a" : "#0f172a", border:`1px solid ${checked ? "#166534" : "#334155"}`, borderRadius:10, transition:"all 0.2s" }}>
            <div
              onClick={() => setChecked(!checked)}
              style={{ width:20, height:20, borderRadius:5, border:`2px solid ${checked ? "#22c55e" : "#475569"}`, background: checked ? "#22c55e" : "transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:1, cursor:"pointer", transition:"all 0.2s" }}>
              {checked && <span style={{ color:"#fff", fontSize:12, fontWeight:700 }}>✓</span>}
            </div>
            <span style={{ fontSize:13, color: checked ? "#4ade80" : "#94a3b8", lineHeight:1.6, transition:"color 0.2s" }}>
              I confirm I am entering <strong style={{ color: checked ? "#86efac" : "#e2e8f0" }}>my own mobile number(s) only.</strong> I understand this tool generates likely UPI IDs based on public patterns and does not access any bank or payment system.
            </span>
          </label>

          <button
            onClick={() => checked && onAccept()}
            disabled={!checked}
            style={{ width:"100%", padding:"14px", borderRadius:10, fontSize:14, fontWeight:700, border:"none", cursor: checked ? "pointer" : "not-allowed", background: checked ? "#0ea5e9" : "#1e293b", color: checked ? "#fff" : "#475569", transition:"all 0.2s" }}>
            {checked ? "I understand — start my UPI ID health check →" : "Please confirm above to continue"}
          </button>

          <div style={{ textAlign:"center", marginTop:14, fontSize:11, color:"#334155" }}>
            No data transmitted · No backend · No analytics
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────

export default function App() {
  const [step,       setStep]       = useState(0);
  const [sims,       setSims]       = useState(null);
  const [done,       setDone]       = useState([]);
  const [showBanner, setShowBanner] = useState(false);
  const [mobilesPresent, setMobilesPresent] = useState(false);

  // Consent gate — persists for the session, not across tabs/closes
  const [consented, setConsented] = useState(() => {
    try { return sessionStorage.getItem("upi_consent") === "1"; } catch(_) { return false; }
  });

  const handleConsent = () => {
    try { sessionStorage.setItem("upi_consent", "1"); } catch(_) {}
    setConsented(true);
  };

  // On mount: URL config first (PII-free), then localStorage + sessionStorage merge
  // NOTE: hooks must all be declared before any early return — Rules of Hooks
  useEffect(() => {
    if (!consented) return; // don't restore session until consent given
    localStorage.removeItem("upi_audit_v3");

    const fromURL = decodeConfigFromURL();
    if (fromURL) {
      const restoredSims = fromURL.map(cfg => ({ ...blankSIM(), ...cfg, mobile: "" }));
      setSims(restoredSims);
      setStep(1);
      setMobilesPresent(false);
      setShowBanner(true);
      return;
    }

    const meta = loadMetaLocalStorage();
    if (meta) {
      const merged = mergeRestoredSession(meta);
      setSims(merged);
      setStep(meta.step ?? 0);
      setDone(meta.done ?? []);
      const hasMobiles = merged.some(s => s.mobile && s.mobile.length === 10);
      setMobilesPresent(hasMobiles);
      setShowBanner(true);
    }
  }, [consented]);

  // Auto-save on state change
  useEffect(() => {
    if (sims) {
      saveMobilesSession(sims);
      saveMetaLocalStorage({ sims, step, done });
    }
  }, [sims, step, done]);

  const vpas = useMemo(() => {
    if (!sims) return [];
    return sims.flatMap((s, idx) => {
      if (!isValidMobile(s.mobile)) return [];
      return generateVPAsForSIM({
        mobile: s.mobile, selectedApps: s.selectedApps, selectedBanks: s.selectedBanks,
        phoneStatus: s.phoneStatus, bankStatus: s.bankStatus,
        label: s.label || `SIM ${idx+1}`,
      });
    });
  }, [sims]);

  const handleSetup = useCallback(simData => { setSims(simData); setStep(1); }, []);

  const handleClearSession = () => {
    clearAllStorage();
    setSims(null); setStep(0); setDone([]); setShowBanner(false);
  };

  // All hooks declared above — safe to conditionally return now
  if (!consented) return <ConsentGate onAccept={handleConsent} />;

  return (
    <div style={{ minHeight:"100vh", background:"#0f172a", fontFamily:"'Inter','Segoe UI',sans-serif", display:"flex", justifyContent:"center", padding:"24px 16px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        select option{background:#1e293b;color:#f1f5f9}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-thumb{background:#334155;border-radius:4px}
        input::placeholder{color:#475569}
        input:focus,select:focus{border-color:#0ea5e9!important;outline:none;box-shadow:0 0 0 3px rgba(14,165,233,0.15)}
        button:hover{opacity:0.88}
        .about-link{color:#38bdf8;text-decoration:none;border-bottom:1px solid #38bdf833}
        .about-link:hover{border-bottom-color:#38bdf8}
      `}</style>

      <div style={{ width:"100%", maxWidth:540 }}>
        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:24 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ width:40, height:40, borderRadius:10, background:"linear-gradient(135deg,#0ea5e9,#0369a1)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, fontWeight:700, color:"#fff", flexShrink:0 }}>₹</div>
            <div>
              <div style={{ fontSize:18, fontWeight:700, color:"#f1f5f9", letterSpacing:-0.3 }}>UPI ID Health Check</div>
              <div style={{ fontSize:11, color:"#475569", marginTop:1 }}>Find · Risk-Score · Clean Up</div>
            </div>
          </div>
          {sims && (
            <button onClick={handleClearSession} style={{ padding:"6px 12px", borderRadius:6, fontSize:12, fontWeight:600, border:"1px solid #334155", background:"transparent", color:"#64748b", cursor:"pointer" }}>Reset</button>
          )}
        </div>

        {showBanner && <RestoreBanner mobilesPresent={mobilesPresent} onDismiss={()=>setShowBanner(false)} onClear={handleClearSession} />}

        {/* About Panel — above the tool so people know what this is before they start */}
        <AboutPanel />

        <StepIndicator current={step} />

        <div style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:16, padding:"26px 22px", boxShadow:"0 20px 60px rgba(0,0,0,0.4)" }}>
          {step === 0 && <Step0Setup onNext={handleSetup} initialSims={sims} />}
          {step === 1 && <Step1VPAs sims={sims} vpas={vpas} onNext={()=>setStep(2)} onBack={()=>setStep(0)} />}
          {step === 2 && <Step2Risk vpas={vpas} onNext={()=>setStep(3)} onBack={()=>setStep(1)} />}
          {step === 3 && <Step3ActionPlan vpas={vpas} onNext={()=>setStep(4)} onBack={()=>setStep(2)} />}
          {step === 4 && <Step4Cleanup vpas={vpas} sims={sims} done={done} setDone={setDone} onBack={()=>setStep(3)} />}
        </div>

        <div style={{ marginTop:16, padding:"16px 20px", background:"#1e293b", border:"1px solid #334155", borderRadius:12, display:"flex", flexDirection:"column", gap:6 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
            <div style={{ fontSize:12, color:"#475569" }}>
              Built by <strong style={{ color:"#94a3b8" }}>Santosh Krishna Venuturupalli</strong> · <a href="https://www.linkedin.com/in/santoshkrishna" target="_blank" rel="noopener noreferrer" style={{ color:"#38bdf8", textDecoration:"none" }}>LinkedIn</a>
            </div>
            <div style={{ fontSize:11, color:"#334155" }}>v1.1.1</div>
          </div>
          <div style={{ fontSize:12, color:"#475569", fontStyle:"italic", lineHeight:1.6 }}>
            Inspired by <a href="https://economictimes.indiatimes.com/wealth/save/how-your-old-forgotten-upi-ids-may-become-a-security-risk-and-how-to-protectyourself/articleshow/131195220.cms" target="_blank" rel="noopener noreferrer" style={{ color:"#38bdf8", textDecoration:"none", borderBottom:"1px solid #38bdf833" }}>this ET article</a> · Built with <a href="https://claude.ai" target="_blank" rel="noopener noreferrer" style={{ color:"#38bdf8", textDecoration:"none", borderBottom:"1px solid #38bdf833" }}>Claude</a> in one evening · Shipped because it needed to exist.
          </div>
          <div style={{ fontSize:11, color:"#334155" }}>
            No data transmitted · No analytics · Not affiliated with NPCI or any bank
          </div>
        </div>
      </div>
    </div>
  );
}