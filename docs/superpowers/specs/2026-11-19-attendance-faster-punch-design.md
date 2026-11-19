# Faster Punch In / Punch Out: Design (short)

Date: 2026-11-19. Status: approved in conversation (option b).

**Why:** pressing Punch In / Punch Out takes 8–20 s. The browser waits up to 8 s for a reading within 50 m (20 s worst case), while the
server accepts up to 1000 m. In the last 14 days 45% of captured punches were over 100 m (mostly laptops), so a strict 100 m rule would
block most staff.

**Goal:** a punch in about 1–3 s; HR sees which punches are imprecise. **Non-goal:** no change to what the server accepts (1000 m), no
database change, no location taken before the button is pressed. **Anti-goal:** a punch refused that is accepted today.

**Approaches:** (a) strict 100 m (fast on phones, blocks ~45% of laptop punches: rejected by the owner); **(b) chosen:** aim for 100 m,
accept up to the server limit with a "low precision" mark; (c) keep waiting longer for precision (the slowness being removed).

**Design**
1. `captureLocation`: finish at once on a reading within **100 m**; otherwise wait at most **3 s** after the first reading for a better
   one and take the best; overall timeout **10 s** (was 50 m / 8 s / 20 s). Same refusal and help when no reading or over the limit.
2. After a punch the card shows the returned day at once; the extra full reload right after the punch is dropped (the place-name lookup
   still refreshes it afterwards).
3. A punch over 100 m shows **"low precision"** next to its accuracy wherever a punch location is shown (the employee's card, HR's
   register and punch list) and in the success message.
4. HR can make 100 m strict later by setting `attendance_settings.max_location_accuracy_m` to 100 (documented).
