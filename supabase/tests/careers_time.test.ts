import assert from 'node:assert/strict';
import { careerDateTimeLocal } from '../../shared/careerTime';
const original = process.env.TZ;
try {
  for (const timezone of ['UTC', 'Asia/Kolkata', 'America/New_York']) {
    process.env.TZ = timezone;
    for (const instant of ['2026-11-02T12:30:00.000Z', '2026-11-02T23:45:00.000Z']) {
      assert.equal(new Date(careerDateTimeLocal(instant)).toISOString(), instant, `editing a deadline must preserve its instant in ${timezone}`);
    }
  }
} finally {
  if (original === undefined) delete process.env.TZ;
  else process.env.TZ = original;
}
console.log('Candidate job deadline timezone checks passed');
