'use strict';
module.exports = async window => {
  const run = code => window.webContents.executeJavaScript(code);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const click = (point, button='left') => {
    window.webContents.sendInputEvent({type:'mouseDown',button,clickCount:1,...point});
    window.webContents.sendInputEvent({type:'mouseUp',button,clickCount:1,...point});
  };
  await run(`(async()=>{
    await window.playerFeatures.closeComparison();
    document.querySelector('.scope-panel button').click();
    document.getElementById('reviewMenu').open=false;
    window.__astriaPlayback.pause();
    document.getElementById('comparisonOpen').click();
    for(let i=0;i<200&&!document.body.classList.contains('comparing');i++)await new Promise(r=>setTimeout(r,25));
    if(!document.body.classList.contains('comparing'))throw Error('Comparison did not open');
  })()`);
  for(const mode of ['side','wipe','blend','toggle']) {
    await run(`document.querySelector('.comparison-mode-bar select').value='${mode}';document.querySelector('.comparison-mode-bar select').dispatchEvent(new Event('change'));`);
    await wait(100);
    await run(`(()=>{
      const mode='${mode}',a=document.getElementById('viewerStage').getBoundingClientRect(),b=document.querySelector('.comparison-view').getBoundingClientRect();
      if(mode==='side'?Math.abs(a.right-b.left)>2:Math.abs(a.width-b.width)>2)throw Error('Mode geometry '+mode);
      if(mode==='wipe'||mode==='blend'){
        const input=document.querySelector('[data-mix] input');input.value='73';input.dispatchEvent(new Event('input'));
        document.querySelector('[data-mix] button').click();
        if(input.value!=='50'||document.querySelector('[data-mix] output').textContent!=='50%')throw Error('Reset failed');
      }
      if(mode==='toggle'){
        document.querySelector('[data-switch]').click();
        if(getComputedStyle(document.querySelector('.comparison-view')).visibility!=='visible')throw Error('B toggle failed');
        document.querySelector('[data-switch]').click();
        if(getComputedStyle(document.querySelector('.comparison-view')).visibility!=='hidden')throw Error('A toggle failed');
      }
    })()`);
  }
  const drag = await run(`(()=>{
    const select=document.querySelector('.comparison-mode-bar select');select.value='wipe';select.dispatchEvent(new Event('change'));
    const r=document.querySelector('.comparison-wipe-overlay').getBoundingClientRect();
    return {x:Math.round(r.left+r.width*.5),y:Math.round(r.top+r.height*.5),end:Math.round(r.left+r.width*.75)};
  })()`);
  await wait(150);
  await run(`window.__wipeEvents=[];for(const type of ['pointerdown','pointermove','pointerup','lostpointercapture'])document.querySelector('.comparison-wipe-handle').addEventListener(type,e=>window.__wipeEvents.push({type:e.type,x:e.clientX,capture:e.target.hasPointerCapture(e.pointerId)}));`);
  window.webContents.sendInputEvent({type:'mouseMove',x:drag.x,y:drag.y});
  window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:drag.x,y:drag.y});
  await wait(40);
  window.webContents.sendInputEvent({type:'mouseMove',button:'left',modifiers:['leftButtonDown'],x:drag.end,y:drag.y});
  await wait(40);
  window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:drag.end,y:drag.y});
  await wait(100);
  await run(`if(Math.abs(Number(document.querySelector('[data-mix] input').value)-75)>1||!window.__astriaPlayback.paused)throw Error('Real wipe drag failed '+JSON.stringify({value:document.querySelector('[data-mix] input').value,paused:window.__astriaPlayback.paused,events:window.__wipeEvents}));`);
  await run(`window.playerFeatures.closeComparison()`);
  const originalBounds = window.getBounds();
  const originalMinimum = window.getMinimumSize();
  try {
    window.setMinimumSize(320,180);
    window.setSize(640,400);
    await run(`document.getElementById('scopeOpen').click()`);
    await wait(150);
    await run(`(()=>{
      const panel=document.querySelector('.scope-panel');
      for(const comparing of [false,true]){
        document.body.classList.toggle('comparing',comparing);
        const r=panel.getBoundingClientRect(),close=panel.querySelector('header button').getBoundingClientRect();
        if(r.top<32||r.bottom>innerHeight||r.left<0||r.right>innerWidth||close.top<r.top||close.bottom>r.bottom)throw Error('Scope or close button escaped small viewport');
      }
      document.body.classList.remove('comparing');
      panel.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
      if(!panel.hidden||document.activeElement!==document.querySelector('#reviewMenu > summary'))throw Error('Scope dismissal lost keyboard focus');
    })()`);
  } finally {
    await run(`document.body.classList.remove('comparing')`);
    window.setBounds(originalBounds);
    window.setMinimumSize(...originalMinimum);
  }
  for(const button of ['left','right']) {
    const point = await run(`(()=>{
      const panel=document.querySelector('.resource-browser');
      if(panel.hidden)document.getElementById('toggleResourceBrowser').click();
      const r=document.getElementById('viewerStage').getBoundingClientRect();return {x:Math.round(r.right-30),y:Math.round(r.top+r.height*.5)};
    })()`);
    click(point,button);await wait(120);
    await run(`if(!document.querySelector('.resource-browser').hidden||!window.__astriaPlayback.paused)throw Error('Outside ${button} dismissal failed');`);
  }
  console.log('RELEASE_UI_PASS modes, reset, real wipe drag, small viewport scopes, scope focus return, left/right outside dismissal');
};
