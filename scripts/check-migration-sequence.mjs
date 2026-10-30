/** Prevent separate feature branches from reusing the same numeric D1/SQLite migration version. */
import {readdirSync} from 'node:fs';
import {resolve} from 'node:path';

const directory=resolve(process.argv[2]||'migrations');
try {
  const seen=new Map();
  const collisions=[];
  for(const file of readdirSync(directory).sort()){
    const match=/^(\d+).*\.sql$/i.exec(file);
    if(!match)continue; // Match the current SQLite and Wrangler migration filename rule.
    const key=BigInt(match[1]).toString();
    const previous=seen.get(key);
    if(previous){
      collisions.push(`Duplicate migration version ${key.padStart(4,'0')}: ${previous} and ${file}`);
    }else{
      seen.set(key,file);
    }
  }
  if(collisions.length){
    throw new Error(collisions.join('\n')+'\nAllocate unique migration versions before merging Phase 7 branches.');
  }
  process.stdout.write(`Migration versions unique: ${seen.size} SQL files in ${directory}\n`);
}catch(error){
  process.stderr.write((error instanceof Error?error.message:String(error))+'\n');
  process.exitCode=1;
}
