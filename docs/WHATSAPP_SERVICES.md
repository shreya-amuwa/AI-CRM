# The three WhatsApp services

| Service | Code | Meaning |
|---|---|---|
| WhatsApp API + Blue Tick | `WHATSAPP_API_BLUE_TICK` | both together (unchanged) |
| WhatsApp API | `WHATSAPP_API` | the WhatsApp Business API on its own |
| Blue Tick | `BLUE_TICK` | the verification (blue tick) on its own |

Migration: `20261120000100_whatsapp_api_and_blue_tick_services.sql` (adds two catalogue rows, safe to run again). Run it after `20261119000100_bolify_call_payload.sql`.

## Same documents and details
All three need the same checklist: the migration gives each new service exactly the items the combined service has (GST certificate, Udyam certificate, Facebook Business Manager, WhatsApp API number, number-not-on-the-app, WABA ID, pricing approval, website URL, plus the always-required items). The checklist of a customer is the union of the items of the services bought, so buying two or all three asks for each document once. Sales picks the services as before (the lead form reads the catalogue, so nothing else changes). The Super Admin can still edit the catalogue (names, prices, descriptions, journeys) from *Service catalogue*.

If a document is later added to the combined service's checklist, add it to the other two the same way (or run the migration again: it only adds what is missing).

## What follows from it
* **Onboarding emails and WhatsApp messages** (Wabastore): sent for a customer who has any one of the three.
* **Message package, campaigns and messages sent** (the WhatsApp details on the customer and the usage meter on the client dashboard): carried by *WhatsApp API* and the combined service, not by *Blue Tick* alone (it has no message package).
* **Excel import:** the service name `WhatsApp API` now means the new service, `Blue Tick` the new one, `WhatsApp API + Blue Tick` the combined one. A WhatsApp usage sheet for a customer who already holds *WhatsApp API* is saved on that service and no combined service is added beside it; for anyone else it works as before.
* Existing customers, leads and invoices keep the service they have: nothing is converted.

## Tests
`supabase/tests/whatsapp_services_test.sql` (section 59) and the "three WhatsApp services" block of `api_integration.test.ts`.
