# Skipped & Deprecated Providers Report

This document records providers from external references (such as OmniRoute) that were evaluated during the provider ecosystem expansion but deliberately skipped or marked deprecated based on FreeLLMAPI's verification, security, and compliance criteria.

---

## 1. Security & Compliance Exclusions (Scraping / Reverse Engineering)

FreeLLMAPI explicitly excludes non-standard auth mechanisms requiring browser cookie extraction, session hijack, or CAPTCHA bypass to ensure zero security vulnerabilities and zero risk of user account suspension.

| Provider | Reason | Verification Status | Action |
| :--- | :--- | :--- | :--- |
| **ChatGPT Web Cookies** | Requires web session cookie extraction and browser scraping. | Non-compliant | Excluded |
| **Claude Web Cookies** | Requires session key extraction from web app local storage. | Non-compliant | Excluded |
| **Qwen Web Session** | Requires web cookie session scraping. | Non-compliant | Excluded |
| **Kimi Web Session** | Requires unofficial session token scraping. | Non-compliant | Excluded |

*Official API/OAuth/Local connections are implemented instead.*

---

## 2. Discontinued & Unreachable Providers

The following providers were checked against their public endpoints and found to be dead, discontinued, or unreachable. Creating fake adapters for these endpoints was rejected.

| Provider | Reason | Verification Status | Action |
| :--- | :--- | :--- | :--- |
| **Galadriel** | API endpoint retired / inactive. | Unreachable (503 / DNS fail) | Skipped (Marked Deprecated) |
| **GLHF** | Community endpoint decommissioned. | Unreachable | Skipped (Marked Deprecated) |
| **Kluster** | Service shut down. | Host unresolvable | Skipped (Marked Deprecated) |
| **Phind API (Unofficial)** | Unofficial endpoint discontinued. | Deprecated | Skipped (Marked Deprecated) |
| **Predibase** | Platform model serving API discontinued. | Decommissioned | Skipped (Marked Deprecated) |

---

## 3. China Regional Policy Exclusions (Default Catalog)

Per FreeLLMAPI's regional governance rules, providers operating under Chinese jurisdiction are excluded from the default model catalog to satisfy strict data residency policies. Users can override this policy via system settings (`china_provider_policy = 'allow'`).

| Provider | Jurisdiction | Regional Exclusion |
| :--- | :--- | :--- |
| **Zhipu AI (BigModel)** | China | Excluded by default |
| **ModelScope (Alibaba)** | China | Excluded by default |
| **SiliconFlow** | China | Excluded by default |
| **Baidu Qianfan** | China | Excluded by default |
| **Volcengine (ByteDance)** | China | Excluded by default |
| **Moonshot Kimi** | China | Excluded by default |
| **iFlytek Spark** | China | Excluded by default |
| **Tencent Hunyuan** | China | Excluded by default |
| **MiniMax CN** | China | Excluded by default |
