# UPI ID Health Check

> Find your forgotten UPI IDs, understand the risk, and clean up — in 3 minutes.

🔗 **Live at [upi.santoshkrishna.in](https://upi.santoshkrishna.in)**

---

## What is this?

Every UPI app you've ever installed — GPay, PhonePe, Paytm, Amazon Pay, CRED — quietly creates several UPI IDs linked to your bank account the moment you sign up. They don't disappear when you uninstall the app. They don't close when you change your phone number. They don't deactivate when you close a bank account.

Most people have 15–40 active UPI IDs they've never seen. This tool helps you find them, understand which ones are a risk, and walk you through cleaning them up — app by app, step by step.

**Inspired by:** [How your old forgotten UPI IDs may become a security risk](https://economictimes.indiatimes.com/wealth/save/how-your-old-forgotten-upi-ids-may-become-a-security-risk-and-how-to-protectyourself/articleshow/131195220.cms) — The Economic Times

---

## How it works

| Step | What happens |
|---|---|
| 1. Setup | Enter your mobile number(s) — current and old SIMs |
| 2. VPA List | See every UPI ID likely created for your numbers across all major apps and banks |
| 3. Risk Breakdown | Each ID scored based on your phone number and bank account status |
| 4. Action Plan | Priority queue — what to do this week vs this month, batched by app |
| 5. Cleanup | Step-by-step instructions to delete each ID, with progress tracking |

Covers: **GPay · PhonePe · Paytm · BHIM · Amazon Pay · CRED · HDFC · ICICI · SBI · Axis Bank**

---

## Privacy & Security

This tool was built with privacy as the primary constraint — not an afterthought.

| What | How |
|---|---|
| **Mobile numbers** | Held in browser memory (React state) and sessionStorage only. Auto-cleared when you close the tab. |
| **localStorage** | Stores only your app/bank selections and progress — never your mobile number. |
| **Network requests** | Zero. There is no backend, no server, no API. Open DevTools → Network tab to verify. |
| **URL sharing** | Share links contain zero personal data — only app selections. Recipient enters their own number. |
| **PDF export** | Mobile numbers masked to last 4 digits only. |
| **Analytics** | None. No Adobe Analytics, no Google Analytics, no Mixpanel, no tracking pixel. Nothing. |

> **The "nothing leaves your device" claim is technically enforceable** — there is no server to send data to. This is the architecture, not just a promise.

---

## Tech Stack

- **React** (Create React App)
- **No backend** — 100% client-side
- **No database**
- **No authentication**
- **No analytics**
- **Hosted on:** Netlify
- **Built with:** [Claude](https://claude.ai) by Anthropic

---

## Running locally

```bash
git clone https://github.com/santoshvenu/upi-id-audit.git
cd upi-id-audit
npm install
npm start
```

Opens at `http://localhost:3000`

To build for production:
```bash
npm run build
```

---

## Important disclaimer

UPI IDs shown are generated based on **standard handle patterns** mandated by NPCI for each PSP — not by connecting to any bank or NPCI system. The tool cannot verify whether any specific ID is active or has been used. Always cross-check by dialling **\*99#** from your SIM — NPCI's own read-only verification service — before taking any action.

This tool is:
- ❌ Not affiliated with NPCI, UPI, or any bank or payment service provider
- ❌ Not a substitute for official bank or NPCI services
- ✅ A free public utility built for Indian UPI users

---

## Contributing

Feedback, bug reports, and pull requests are welcome.

If you've found a UPI handle pattern that's missing, or cleanup steps that have changed for a specific app — please open an issue or PR. This tool is only as accurate as its data.

---

## Version history

| Version | What changed |
|---|---|
| v1.1.1 | Removed idle scoring — risk now based on phone/bank status only |
| v1.1.0 | Added Action Plan step — priority queue, app batching, time estimates |
| v1.0.1 | Mobile responsive fix — block layout, viewport meta, OG tags for social sharing |
| v1.0.0 | Initial public release — consent gate, 5-step flow, PDF export, share link, security hardening, about panel, footer |

---

## Built by

**Santosh Krishna Venuturupalli** — Principal Data Solutions Architect, Mediacorp · [LinkedIn](https://www.linkedin.com/in/santoshkrishna)

*Built with Claude in one evening. Shipped because it needed to exist.*