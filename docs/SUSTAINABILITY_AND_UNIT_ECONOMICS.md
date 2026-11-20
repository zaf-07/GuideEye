# GuideEye — Sustainability, Operating Costs, & Customer Adoption Plan

> **Evaluation Criteria:** Sustainability & Long-Term Value (10% Weight)  
> **Target Audience:** Hackathon Judges, Angel Investors, and University Accessibility Directors  

---

## 1. Operating Cost Breakdown (COGS Analysis)

Because GuideEye was engineered with a **hybrid edge-cloud architecture**, safety-critical computations run entirely on-device (zero cloud cost), while reasoning and natural voice use targeted APIs.

### Per-Active-User Daily & Monthly Cost Model
*Based on 25 daily interactions (15 hazard checks, 6 conversational queries, 2 document errands, 2 walking navigation trips):*

| Service | Cloud Cost Component | Cost per Unit | Daily Usage | Daily Cost | Monthly Cost (30d) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **On-Device Vision (YOLO11n)** | Edge Neural Engine (Mac / iPhone) | $0.00 / frame | ~300 frames evaluated | **$0.00** | **$0.00** |
| **On-Device ASL Recognition** | Edge MediaPipe / Apple Vision | $0.00 / frame | Continuous tracking | **$0.00** | **$0.00** |
| **Local Private Memory** | On-device SQLite + Graph | $0.00 / query | 25 local transactions | **$0.00** | **$0.00** |
| **Speech-to-Text (STT)** | Deepgram Nova-3 | $0.0043 / min | 3.5 minutes audio | $0.015 | $0.45 |
| **Natural Voice Out (TTS)** | ElevenLabs Flash / Deepgram Aura | $0.015 / 1k chars | 1,800 characters | $0.027 | $0.81 |
| **Cloud Scene Reasoning** | Google Gemini 2.5 Flash Lite | $0.075 / 1M tokens | 40k input/output tokens | $0.003 | $0.09 |
| **Document Errand Reasoning** | HarnessRouter UHP (`chrn_e00fb0...`) | $0.015 / errand | 2 multi-step errands | $0.030 | $0.90 |
| **Server Infrastructure** | Render Docker container hosting | Fixed pool allocation | Pro-rated per active user | $0.005 | $0.15 |
| **TOTAL COGS PER ACTIVE USER** | — | — | — | **$0.080 / day** | **$2.40 / month** |

> **Key Takeaway:** An active daily user costs only **$2.40 per month** to support, providing exceptional unit economic scalability.

---

## 2. Pricing & Revenue Strategy

GuideEye operates on a tiered B2C freemium and B2B campus/enterprise license model:

### Tier 1: Free On-Device Edition ($0 / month)
- On-device YOLO hazard radar and obstacle audio warnings.
- Local turn-by-turn navigation using OpenStreetMap.
- Local-only memory graph (encrypted SQLite).
- Basic on-device speech synthesis.
- *Customer Value:* Immediate barrier-free access for low-income and international users.

### Tier 2: GuideEye Pro ($9.99 / month or $99 / year)
- Natural ElevenLabs voice narration.
- Unlimited HarnessRouter UHP document errand processing (bills, medical paperwork, mail).
- Cloud Supermemory cross-device synchronization.
- Full Deaf-Blind Bridge with 3D ASL Avatar animation.
- *Gross Margin:* **75.9%** ($9.99 revenue minus $2.40 COGS).

### Tier 3: Enterprise & University Campus License ($49.00 / seat / month)
- Deployed across university Offices of Accessible Education (OAE), assisted living networks, and vocational rehabilitation centers.
- Shared Sight campus memory integration (hazard mapping across campus buildings).
- FERPA / HIPAA-isolated private server instances.
- Dedicated onboarding support and hardware wristband kits.
- *Gross Margin:* **78.4%** ($49.00 revenue minus $10.58 enterprise support & compute cost).

---

## 3. Customer Adoption & Go-to-Market Roadmap

```
[Phase 1: Q4 2026]
Stanford & Bay Area Campus Pilots
- 10-seat paid pilot ($1,470 committed via current LOI).
- Partner with student disability alliances and campus access coordinators.
- Refine indoor navigation & document parsing workflows.

[Phase 2: Q1–Q2 2027]
State Vocational Rehabilitation & Foundation Partnerships
- Apply for California Department of Rehabilitation assistive tech vendor status.
- Partner with Lighthouse for the Blind and National Federation of the Blind (NFB) chapters.
- Expand B2C Pro subscriptions through word-of-mouth in assistive communities.

[Phase 3: Q3–Q4 2027]
Hardware Bundles & Insurance / Grant Reimbursement
- Bundle pre-configured BLE wristband and chest clip mounts.
- Seek Medicaid / Medicare Assistive Device reimbursement coding (HCPCS).
- Scale enterprise deployments to 50+ universities nationwide.
```

---

## 4. Sustainability & Long-Term Viability

1. **Defensibility:** Hybrid edge-first architecture means GuideEye does not collapse under cloud API rate limits or network dropouts. Core safety features run offline forever.
2. **Data Privacy moat:** By storing text notes rather than raw video, GuideEye avoids expensive visual storage infrastructure and eliminates privacy/regulatory compliance hurdles.
3. **Ecosystem Leverage:** Utilizing the Universal Harness Protocol (UHP) allows GuideEye to seamlessly upgrade or substitute backend foundation models without breaking wearable client contracts.
