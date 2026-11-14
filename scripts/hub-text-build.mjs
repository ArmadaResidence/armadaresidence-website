// Writes supabase/functions/_shared/hub/text.generated.json from docs/guest-hub/copy.md and prompts.md (Guest Hub H5,
// 14 Nov 2026). Run after editing either file; hub-copy-check (FAST_CHECKS) fails while the generated file is stale.
//   node scripts/hub-text-build.mjs
import { writeFileSync } from 'node:fs';
import { generated } from './hub-text-lib.mjs';

const out = new URL('../supabase/functions/_shared/hub/text.generated.json', import.meta.url);
writeFileSync(out, JSON.stringify(generated(), null, 1) + '\n', 'utf8');
console.log('✓ wrote supabase/functions/_shared/hub/text.generated.json');
