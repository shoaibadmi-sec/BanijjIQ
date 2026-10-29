/** Cloudflare Builds "Build command" entry point. No remote API calls or migrations. */
import {spawnSync} from 'node:child_process';
import process from 'node:process';

const steps=[
 ['npm',['ci']],
 ['npm',['run','react:build']],
 // The repository's legacy release uses older Wrangler; install an exact, new-enough
 // Wrangler only inside ephemeral Cloudflare Builds, without changing its lockfile.
 ['npm',['install','--no-save','--package-lock=false','wrangler@4.135.0']],
 ['node',['scripts/preview/build-pr-config.mjs']]
];
for(const [cmd,args] of steps){
 console.log('PR Preview build step: '+cmd+' '+args.join(' '));
 const result=spawnSync(cmd,args,{stdio:'inherit',env:process.env});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status||1);
}
console.log('PR Preview assets/config ready. Native Preview deployment is a SEPARATE Cloudflare command.');
