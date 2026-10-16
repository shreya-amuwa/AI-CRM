# Amuwa Design Studio services

Migration: `supabase/migrations/20261024000100_design_studio_services.sql` (additive, safe to rerun in the Supabase SQL editor).

## Services

Six services in the catalogue under the category **Amuwa Design Studio** (their own group in the service picker,
codes `DS_*`). The existing services with similar names (GMB Ranking, Meta Ads Management, Social Media
Management, the Yearly ... Creative packages) are separate and unchanged.

| Service | Collected in Customer onboarding |
| --- | --- |
| Social Media Marketing | Instagram account (access), Facebook page access, Business Gmail ID, YouTube channel access |
| Google My Business Ranking | Google Business Profile access, business profile details |
| Meta Ads | Facebook Page ID & access, Instagram account & access, basic business documents (upload), business requirements, **Creatives required? (Yes / No)**; on **Yes** also a creative brief (required) and creative assets (optional upload) |
| AI Video Production | Business logo (upload), brand details, business phone number, business address |
| Yearly Creative Package | Business logo (upload), brand details, business phone number, business address |
| Graphic Design | Business logo (upload), brand details, business phone number, business address |

## How it works

* **Selecting.** The lead form (new and edit) shows the six services under *Amuwa Design Studio*. When one is
  selected, a card lists what onboarding will collect for it (one card per selected service; deselecting removes it).
* **Collecting.** The details are entered in the existing **Customer onboarding** checklist, grouped under each
  service's name, with the usual required / optional marking, file checks (type, 2 MB) and Technical Consultant
  review. Every service has its own items (`DS_<service>_*`), so the logo, phone, address or brand details saved for
  one service never overwrite another's. They are stored per customer in `customer_onboarding_entries` and documents
  in `customer_documents` (under `customers/<id>/onboarding/`), so they stay with the record from lead to customer.
* **Conditional items.** `onboarding_items.shown_when_item` / `shown_when_value` show an item only while another
  item has that answer. Meta Ads uses it for the creative fields. An administrator can add more creative items the
  same way (an item mapped to `DS_META_ADS` with `shown_when_item = 'DS_META_CREATIVES_REQUIRED'`,
  `shown_when_value = 'YES'`). Hidden items do not count towards progress and cannot be saved; what was entered is
  kept and comes back if the answer is changed back to Yes.
* **Account access - no passwords.** Every account item is an *Access* item: the account handle / ID and how Amuwa
  was given delegated access (Meta Business partner access, YouTube channel Manager, Google Business Profile
  Manager). Instagram, Facebook, YouTube and Google Business Profile all support delegated access, so passwords are
  never requested; an entry that contains one ("password: ...", "pwd=...") is refused by the database.
* **Who can see it.** Unchanged role rules: the sales owner (and their leads / heads), and the Technical Consultant
  once onboarding reaches them. Other salespeople and clients get "not found"; entries are not readable directly.
* **No client pop-ups.** The services are added without the automatic "New service" announcement to every client.
  A Department Head can announce them with the existing option when they are ready to be offered.

Note: the migration redefines `private.customer_items`, `private.customer_optional_items` and
`private.customer_addon_items` (same logic plus the condition). Rerunning an older migration that defines those
functions afterwards would drop the condition; rerun this migration after it.
