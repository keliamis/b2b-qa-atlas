import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
let count=0;
for(const dir of ['backend/src','scripts','tests']) {
 for(const file of readdirSync(dir).filter(f=>f.endsWith('.mjs'))) {
  const result=spawnSync(process.execPath,['--check',join(dir,file)],{stdio:'inherit'});
  if(result.status!==0)process.exit(1);
  count++;
 }
}
console.log(`Syntax checked: ${count} JavaScript modules`);
