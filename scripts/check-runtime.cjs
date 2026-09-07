'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
module.exports=function checkRuntime(directory){
  const vswhere=path.join(process.env['ProgramFiles(x86)'],'Microsoft Visual Studio/Installer/vswhere.exe');
  const vs=execFileSync(vswhere,['-latest','-products','*','-property','installationPath'],{encoding:'utf8'}).trim();
  const versions=fs.readdirSync(path.join(vs,'VC/Tools/MSVC')).sort();
  const dumpbin=path.join(vs,'VC/Tools/MSVC',versions.at(-1),'bin/Hostx64/x64/dumpbin.exe');
  const names=fs.readdirSync(directory).filter(name=>/\.(?:dll|node)$/i.test(name));
  const bundled=new Set(names.map(name=>name.toLowerCase()));
  const missing=new Set();
  for(const name of names){
    const output=execFileSync(dumpbin,['/dependents',path.join(directory,name)],{encoding:'utf8'});
    for(const line of output.split('\n')){
      const dependency=line.trim().toLowerCase();
      if(!/^[\w.-]+\.dll$/.test(dependency)||dependency==='node.dll'||bundled.has(dependency)||/^(?:api|ext)-ms-/.test(dependency))continue;
      if(!fs.existsSync(path.join(process.env.SystemRoot,'System32',dependency)))missing.add(`${name}: ${dependency}`);
    }
  }
  if(missing.size)throw new Error('Missing runtime DLLs: '+[...missing].join(', '));
  console.log(`Runtime dependency closure: ${names.length} bundled binaries, no missing DLLs`);
};
