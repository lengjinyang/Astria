window.createPlayerFeatures = ({ playback: p, state, toast, resize, exitClean, subtitleChanged, source }) => {
  const api = window.desktopAPI,
    $ = (id) => document.getElementById(id);
  const hud = document.createElement('output');
  hud.className = 'playback-feedback';
  hud.setAttribute('aria-live', 'polite');
  document.body.append(hud);
  let hudTimer;
  function notice(text) {
    const dock = document.querySelector('.bottom-dock').getBoundingClientRect();
    hud.style.left = `${dock.left + dock.width / 2}px`;
    hud.style.bottom = `${Math.max(60, innerHeight - dock.top + (document.body.classList.contains('comparing') ? 104 : 16))}px`;
    hud.textContent = text;
    hud.classList.add('visible');
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => hud.classList.remove('visible'), 1000);
  }
  const panel = document.createElement('section');
  panel.className = 'playback-tools';
  panel.setAttribute('aria-label', '播放与分析');
  panel.hidden = true;
  panel.innerHTML = `<header><b>播放与分析</b><button data-close>关闭</button></header>
  <fieldset><legend>A/B 视频对比</legend><button id="comparisonOpen">选择 B 视频</button><button id="comparisonClose" disabled>结束对比</button><label>B 时间偏移（帧）<input id="comparisonOffset" type="number" value="0" step="1"></label><small>A 为当前视频，B 默认静音。偏移按 B 视频帧率计算，正值使 B 提前，负值使 B 延后。</small><output id="comparisonStatus"></output></fieldset>
  <fieldset><legend>波形图／直方图</legend><button id="scopeOpen" type="button">打开</button><select id="scopeMode" hidden aria-hidden="true"><option value="off">关闭</option><option value="waveform">亮度波形</option><option value="rgb-waveform">RGB 波形</option><option value="parade">RGB 分量图</option><option value="histogram">RGB 直方图</option><option value="vectorscope">矢量示波器</option></select><small>基于当前 SDR 查看画面，范围 0–255；降采样分析。</small></fieldset>
  <fieldset id="trackTools"><legend>字幕与音轨</legend><label>字幕<select id="subtitleTrack"></select></label><button id="subtitleOpen">加载本地字幕…</button><button id="tracksRefresh">刷新轨道</button><small>自动匹配同文件夹中与视频文件名相关的字幕。</small><label>字幕偏移（秒）<input id="subtitleDelay" type="number" value="0" min="-30" max="30" step="0.1"></label><label>字幕大小（%）<input id="subtitleScale" type="number" value="100" min="25" max="400" step="1"></label><label>音轨<select id="audioTrack"></select></label><label>音画同步（秒）<input id="audioDelay" type="number" value="0" min="-30" max="30" step="0.05"></label><small>正值延后，负值提前。</small></fieldset>
  <label id="pinTools"><input id="alwaysOnTop" type="checkbox"> 窗口置顶</label><small>X / C 降低／提高倍速 · Shift+X 拾色 · 双击画面全屏</small>`;
  document.body.append(panel);
  const icons = {
    comparison: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14"/>',
    scope: '<path d="M3 4v16h18M6 15l3-7 4 9 3-11 3 7"/>',
    subtitle: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M6 11h5M14 11h4M6 15h3M12 15h6"/>',
    audio: '<path d="M4 10h4l5-4v12l-5-4H4zM16 9a5 5 0 0 1 0 6M19 6a9 9 0 0 1 0 12"/>',
    pin: '<path d="m9 3 6 0-1 6 4 4v2H6v-2l4-4zM12 15v6"/>',
  };
  const svg = key => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[key]}</svg>`;
  const review = document.querySelector('.review-tool-cluster');
  function reviewFeature(id, title, icon, content) {
    const details = document.createElement('details');
    details.id = id;
    details.className = 'top-tool-popover feature-review-tool';
    details.innerHTML = `<summary class="top-tool-button" title="${title}">${svg(icon)}<span>${title}</span><i></i></summary><div class="top-tool-panel feature-fields"></div>`;
    details.lastElementChild.append(content);
    review.append(details);
    details.addEventListener('keydown', event => event.stopPropagation());
  }
  reviewFeature('comparisonTool', 'A/B 视频对比', 'comparison', panel.querySelector('fieldset'));
  reviewFeature('scopeTool', '视频示波器', 'scope', panel.querySelector('fieldset'));
  const tracks = $('trackTools');
  const audioFields = document.createElement('fieldset');
  audioFields.id = 'audioTools';
  audioFields.innerHTML = '<legend>音轨与音画同步</legend>';
  audioFields.append($('audioTrack').closest('label'), $('audioDelay').closest('label'), tracks.lastElementChild);
  panel.append(audioFields);
  tracks.querySelector('legend').textContent = '字幕';
  $('pinTools').remove();
  panel.querySelector(':scope > small').remove();
  reviewFeature('subtitleTool', '字幕', 'subtitle', tracks);
  reviewFeature('audioTool', '音轨与音画同步', 'audio', audioFields);
  for (const id of ['subtitleTool', 'audioTool']) {
    $(id).hidden = !api;
    $(id).addEventListener('toggle', () => { if ($(id).open) void safe(refreshTracks)(); });
  }
  panel.remove();
  const pinButton = document.createElement('button');
  pinButton.id = 'alwaysOnTop';
  pinButton.className = 'icon-button playback-feature-button';
  pinButton.title = '窗口置顶';
  pinButton.setAttribute('aria-label', '窗口置顶');
  pinButton.innerHTML = svg('pin');
  pinButton.hidden = !api;
  pinButton.setAttribute('aria-pressed', 'false');
  $('toggleResourceBrowser').after(pinButton);
  function inlineReviewActions(id, actions) {
    const details=$(id), row=document.createElement('div');
    row.className='review-inline-actions';
    row.setAttribute('role','group');
    row.setAttribute('aria-label',details.querySelector('summary').textContent.trim()+'快捷操作');
    details.querySelector('summary').append(row);
    row.addEventListener('click',event=>{event.stopPropagation();if(event.target===row)event.preventDefault();});
    row.addEventListener('keydown',event=>event.stopPropagation());
    row.addEventListener('keyup',event=>event.stopPropagation());
    for(const [label,targetId] of actions){
      const button=document.createElement('button');button.type='button';button.textContent=label;
      const target=$(targetId);
      button.onclick=event=>{event.preventDefault();event.stopPropagation();target.click();};
      if(target.type==='checkbox'){
        const sync=()=>button.setAttribute('aria-pressed',String(target.checked));
        target.addEventListener('change',sync);$('reviewMenu').addEventListener('toggle',sync);sync();
      }
      row.append(button);
    }
  }
  inlineReviewActions('colorViewTool',[]);
  const colorSelect=$('colorPresetSelect'),colorLabel=colorSelect.closest('label');
  colorSelect.setAttribute('aria-label','色彩查看预设');
  $('colorViewTool').querySelector('.review-inline-actions').append(colorSelect);
  colorLabel.remove();
  inlineReviewActions('guideViewTool',[['三分法','guideThirds'],['中心','guideCenter']]);
  inlineReviewActions('comparisonTool',[['选择视频','comparisonOpen']]);
  inlineReviewActions('scopeTool',[['打开','scopeOpen']]);
  const safe = (fn) => async () => {
    try {
      await fn();
    } catch (e) {
      toast(e.message || String(e));
    }
  };
  async function refreshTracks() {
    if (!api || !p.readyState) return;
    const media = p.media;
    const [tracks, settings] = await Promise.all([p.call('tracks'), p.call('trackSettings')]);
    if (p.media !== media || !tracks) return;
    for (const [id, key] of [
      ['subtitleDelay', 'sub-delay'],
      ['audioDelay', 'audio-delay'],
      ['subtitleScale', 'sub-scale'],
    ])
      if (document.activeElement !== $(id)) $(id).value = key === 'sub-scale'
        ? Math.round(settings[key] * 100) : Number(settings[key].toFixed(3));
    for (const [id, type] of [
      ['subtitleTrack', 'sub'],
      ['audioTrack', 'audio'],
    ]) {
      const select = $(id);
      select.replaceChildren(new Option(type === 'sub' ? '关闭字幕' : '关闭音轨', 'no'));
      for (const track of tracks.filter((t) => t.type === type)) {
        const o = new Option(
          [track.id, track.title, track.lang, track.codec].filter(Boolean).join(' · '),
          track.id,
        );
        select.append(o);
        if (track.selected) o.selected = true;
      }
    }
  }
  for (const [id, key] of [
    ['subtitleTrack', 'sid'],
    ['audioTrack', 'aid'],
    ['subtitleDelay', 'sub-delay'],
    ['audioDelay', 'audio-delay'],
    ['subtitleScale', 'sub-scale'],
  ])
    $(id).onchange = safe(async () => {
      if (!p.readyState) throw Error('请先打开视频');
      if (!$(id).reportValidity() || $(id).value === '') return;
      const value = $(id).value;
      await p.call('configureTrack', key, value === 'no' ? 'no' : Number(value) / (key === 'sub-scale' ? 100 : 1));
      if (key === 'sid' || key.startsWith('sub-')) subtitleChanged();
      notice('已更新');
    });
  $('subtitleOpen').onclick = safe(async () => {
    if (!p.readyState) throw Error('请先打开视频');
    await p.call('addSubtitle');
    subtitleChanged();
    await refreshTracks();
  });
  $('tracksRefresh').onclick = safe(refreshTracks);
  pinButton.onclick = safe(async () => {
    const value = await api.setAlwaysOnTop(pinButton.getAttribute('aria-pressed') !== 'true');
    pinButton.setAttribute('aria-pressed', String(value));
    pinButton.title = value ? '取消窗口置顶' : '窗口置顶';
    notice(value ? '窗口已置顶' : '已取消置顶');
  });
  p.addEventListener('loadeddata', () => {
    if ($('subtitleTool').open || $('audioTool').open) void safe(refreshTracks)();
  });
  let b = null,
    offset = 0,
    comparisonTicket = 0,
    objectUrl = null,
    lastSync = 0,
    lastBResync = -Infinity,
    pendingBSeek = false,
    cancelComparisonLoad = null;
  const comparison = document.createElement('section');
  comparison.className = 'comparison-view';
  comparison.hidden = true;
  comparison.innerHTML = '<span>B · 静音</span>';
  document.querySelector('.viewer-column').append(comparison);
  const comparisonControls = document.createElement('div');
  comparisonControls.className = 'comparison-controls';
  comparisonControls.hidden = true;
  document.querySelector('.viewer-column').append(comparisonControls);
  comparisonControls.append($('comparisonStatus'), $('comparisonOffset').closest('label'));
  const resetOffset = document.createElement('button');
  resetOffset.textContent = '偏移归零';
  resetOffset.onclick = () => { $('comparisonOffset').value = '0'; $('comparisonOffset').dispatchEvent(new Event('change')); };
  comparisonControls.append(resetOffset, $('comparisonClose'));
  const bTimeline = document.createElement('label');
  bTimeline.className = 'comparison-timeline';
  bTimeline.innerHTML = '<span>B 位置</span><input id="comparisonPosition" type="range" min="0" max="1" value="0" step="0.041667" aria-label="拖动 B 视频位置以调整时间偏移"><output id="comparisonPositionText">00:00:00</output>';
  comparisonControls.prepend(bTimeline);
  const comparisonModeBar = document.createElement('div');
  comparisonModeBar.className = 'comparison-mode-bar';
  comparisonModeBar.innerHTML = '<label>对比方式 <select aria-label="对比方式"><option value="side">左右并排</option><option value="wipe">滑动擦拭</option><option value="blend">透明叠加</option><option value="toggle">单画面切换</option></select></label><label data-mix hidden><span>分界位置</span><input type="range" min="0" max="100" value="50" aria-label="对比分界位置"><output>50%</output></label><button type="button" data-switch hidden>当前 A · 切换到 B</button>';
  comparisonControls.prepend(comparisonModeBar);
  const modeSelect = comparisonModeBar.querySelector('select');
  const mixLabel = comparisonModeBar.querySelector('[data-mix]');
  const mixSlider = mixLabel.querySelector('input');
  const resetMixButton = document.createElement('button');
  resetMixButton.type = 'button';
  resetMixButton.textContent = '恢复默认';
  resetMixButton.title = '恢复为 50%';
  resetMixButton.onclick = () => {
    mixSlider.value = '50';
    updateComparisonMix();
  };
  mixLabel.append(resetMixButton);
  const switchButton = comparisonModeBar.querySelector('[data-switch]');
  const wipeOverlay = document.createElement('div');
  wipeOverlay.className = 'comparison-wipe-overlay';
  const wipeHandle = document.createElement('button');
  wipeHandle.type = 'button';
  wipeHandle.className = 'comparison-wipe-handle';
  wipeHandle.setAttribute('role', 'slider');
  wipeHandle.setAttribute('aria-label', '拖动 AB 对比分界线');
  wipeHandle.setAttribute('aria-valuemin', '0');
  wipeHandle.setAttribute('aria-valuemax', '100');
  wipeHandle.setAttribute('aria-orientation', 'horizontal');
  wipeHandle.title = '左右拖动分界线';
  wipeOverlay.append(wipeHandle);
  document.querySelector('.viewer-column').append(wipeOverlay);
  function updateComparisonMix() {
    mixLabel.querySelector('output').textContent = `${mixSlider.value}%`;
    comparison.style.setProperty('--comparison-split', `${mixSlider.value}%`);
    comparison.style.setProperty('--comparison-opacity', Number(mixSlider.value) / 100);
    wipeOverlay.style.setProperty('--comparison-split', `${mixSlider.value}%`);
    wipeHandle.setAttribute('aria-valuenow', mixSlider.value);
  }
  function moveWipe(event) {
    const bounds = wipeOverlay.getBoundingClientRect();
    if (!bounds.width) return;
    mixSlider.value = String(Math.round(Math.max(0, Math.min(100, (event.clientX - bounds.left) / bounds.width * 100))));
    updateComparisonMix();
  }
  wipeHandle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    wipeHandle.setPointerCapture(event.pointerId);
    wipeHandle.focus({ preventScroll: true });
    moveWipe(event);
  });
  wipeHandle.addEventListener('pointermove', event => {
    if (!wipeHandle.hasPointerCapture(event.pointerId)) return;
    event.stopPropagation(); moveWipe(event);
  });
  for (const type of ['pointerup', 'pointercancel']) wipeHandle.addEventListener(type, event => {
    event.stopPropagation();
    if (wipeHandle.hasPointerCapture(event.pointerId)) wipeHandle.releasePointerCapture(event.pointerId);
  });
  for (const type of ['click', 'dblclick', 'contextmenu']) wipeHandle.addEventListener(type, event => {
    event.preventDefault(); event.stopPropagation();
  });
  wipeHandle.addEventListener('keydown', event => {
    event.stopPropagation();
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    mixSlider.value = String(event.key === 'Home' ? 0 : event.key === 'End' ? 100 : Number(mixSlider.value) + (event.key === 'ArrowLeft' ? -1 : 1));
    updateComparisonMix();
  });
  let showB = false;
  function updateComparisonMode() {
    const mode = modeSelect.value;
    document.body.dataset.comparisonMode = mode;
    document.body.dataset.comparisonSource = showB ? 'b' : 'a';
    mixLabel.hidden = mode !== 'wipe' && mode !== 'blend';
    switchButton.hidden = mode !== 'toggle';
    const mixTitle = mode === 'blend' ? 'B 不透明度' : '分界位置';
    mixLabel.querySelector('span').textContent = mixTitle;
    mixSlider.setAttribute('aria-label', mixTitle);
    updateComparisonMix();
    comparison.querySelector('span').textContent = mode === 'blend' ? 'A + B · 叠加' : 'B · 静音';
    switchButton.textContent = showB ? '当前 B · 切换到 A' : '当前 A · 切换到 B';
    resize();
  }
  modeSelect.onchange = updateComparisonMode;
  mixSlider.oninput = updateComparisonMix;
  switchButton.onclick = () => { showB = !showB; updateComparisonMode(); };
  new ResizeObserver(() => {
    if (!comparisonControls.hidden) document.querySelector('.viewer-column').style.setProperty('--comparison-controls-height', `${comparisonControls.offsetHeight}px`);
  }).observe(comparisonControls);
  let aligning = false, resumeAfterAlign = false, alignAnchor = 0;
  function beginAlign() {
    if (!b || aligning) return;
    aligning = true; alignAnchor = p.currentTime;
    resumeAfterAlign = !p.paused;
    p.pause(); b.pause();
  }
  function finishAlign() {
    if (!aligning) return;
    aligning = false;
    if (resumeAfterAlign) void p.play().catch(() => {});
    resumeAfterAlign = false;
    syncComparison(true);
  }
  const position = $('comparisonPosition');
  position.addEventListener('pointerdown', beginAlign);
  position.addEventListener('input', () => {
    if (!b) return;
    const target = Number(position.value);
    offset = Math.round((target - (aligning ? alignAnchor : p.currentTime)) * comparisonFps());
    $('comparisonOffset').value = String(offset);
    $('comparisonPositionText').textContent = timeLabel(target);
    syncComparison(true);
  });
  position.addEventListener('change', finishAlign);
  position.addEventListener('pointercancel', finishAlign);
  position.addEventListener('blur', finishAlign);
  window.addEventListener('pointerup', finishAlign);
  $('comparisonClose').textContent = '退出对比';
  comparisonControls.addEventListener('keydown', event => event.stopPropagation());

  async function closeComparison() {
    finishAlign();
    comparisonTicket++;
    cancelComparisonLoad?.();
    const old = b,
      oldUrl = objectUrl;
    b = null;
    objectUrl = null;
    pendingBSeek = false;
    lastBResync = -Infinity;
    document.body.classList.remove('comparing');
    comparison.hidden = true;
    comparisonControls.hidden = true;
    comparison.querySelector('canvas,video')?.remove();
    $('comparisonClose').disabled = true;
    $('comparisonStatus').textContent = '';
    resize();
    try {
      if (old) await old.destroy();
    } finally {
      if (oldUrl) URL.revokeObjectURL(oldUrl);
    }
  }
  async function chooseBrowserFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'video/*';
      input.oncancel = () => resolve(null);
      input.onchange = () => resolve(input.files[0] || null);
      input.click();
    });
  }
  $('comparisonOpen').onclick = safe(async () => {
    if (!p.readyState) throw Error('请先打开 A 视频');
    const originalMedia = p.media,
      requestTicket = comparisonTicket;
    $('comparisonOpen').disabled = true;
    try {
      let media;
      if (api) media = await api.chooseComparison();
      else {
        const file = await chooseBrowserFile();
        if (file) media = { name: file.name, url: URL.createObjectURL(file) };
      }
      if (!media) return;
      if (p.media !== originalMedia || requestTicket !== comparisonTicket) {
        if (!api) URL.revokeObjectURL(media.url);
        return;
      }
      await closeComparison();
      if (!api) objectUrl = media.url;
      const ticket = ++comparisonTicket;
      exitClean();
      b = AstriaPlayback.create();
      const player = b;
      player.muted = true;
      player.setProjectFps(state.fps);
      comparison.append(player.surface);
      player.addEventListener('error', () => {
        if (b === player) {
          $('comparisonStatus').textContent = 'B 视频载入或播放失败';
        }
      });
      player.addEventListener('seeked', () => {
        if (b === player && pendingBSeek) {
          pendingBSeek = false;
          syncComparison(true);
        }
      });
      const loaded = new Promise((resolve, reject) => {
        const finish = (error) => {
          clearTimeout(timer);
          player.removeEventListener('loadeddata', onLoaded);
          player.removeEventListener('error', onError);
          cancelComparisonLoad = null;
          error ? reject(error) : resolve();
        };
        const onLoaded = () => finish();
        const onError = () => finish(Error('B 视频载入失败'));
        const timer = setTimeout(() => finish(Error('B 视频载入超时')), 15000);
        cancelComparisonLoad = onLoaded;
        player.addEventListener('loadeddata', onLoaded, { once: true });
        player.addEventListener('error', onError, { once: true });
      });
      try {
        await Promise.all([player.open(media), loaded]);
      } catch (error) {
        if (ticket === comparisonTicket) await closeComparison();
        throw error;
      }
      if (ticket !== comparisonTicket) return;
      comparison.hidden = false;
      comparisonControls.hidden = false;
      position.max = String(Math.max(0, player.duration - 1 / (player.media?.sourceFps || state.fps)));
      position.step = String(1 / comparisonFps());
      $('comparisonOffset').title = `按 B 视频 ${comparisonFps().toFixed(3)} FPS 计算，每次调整 1 帧`;
      $('reviewMenu').open = false;
      document.body.classList.add('comparing');
      updateComparisonMode();
      $('comparisonClose').disabled = false;
      $('comparisonStatus').textContent = 'B · ' + media.name;
      resize();
      syncComparison(true);
    } finally {
      $('comparisonOpen').disabled = false;
    }
  });
  $('comparisonClose').onclick = safe(closeComparison);
  function comparisonFps() { return b?.media?.sourceFps || state.fps || 24; }
  $('comparisonOffset').onchange = () => {
    offset = Math.round(Number($('comparisonOffset').value) || 0);
    $('comparisonOffset').value = String(offset);
    syncComparison(true);
  };
  function syncComparison(force = false) {
    if (!b || b.readyState < 2) return;
    const now = performance.now();
    if (!force && now - lastSync < 180) return;
    lastSync = now;
    const target = (aligning ? alignAnchor : p.currentTime) + offset / comparisonFps();
    const inRange = target >= 0 && target < b.duration;
    const time = Math.max(0, Math.min(b.duration - 0.001, target));
    const continuous = !p.paused && !aligning && inRange && !state.isReverse;
    const drift = time - b.currentTime;
    const correction = continuous && !force && !b.seeking && Math.abs(drift) > 0.04
      ? Math.max(-0.05, Math.min(0.05, drift * 0.15)) : 0;
    const speed = p.playbackRate * (1 + correction);
    if (Math.abs(b.playbackRate - speed) > 0.005) b.playbackRate = speed;
    b.setProjectFps(state.fps);
    if (b.seeking) {
      pendingBSeek ||= force;
    } else if (force || (!continuous && Math.abs(drift) > 0.5 / comparisonFps()) ||
        (continuous && Math.abs(drift) > 0.5 && now - lastBResync > 1500)) {
      lastBResync = now;
      b.seek(time);
    }
    if (p.paused || aligning || !inRange || state.isReverse) {
      if (!b.paused) b.pause();
    } else if (b.paused) void b.play().catch(() => {});
    comparison.dataset.outOfRange = String(!inRange);
    if (!aligning) position.value = String(time);
    $('comparisonPositionText').textContent = `${timeLabel(time)} / ${timeLabel(b.duration)}`;
  }
  for (const type of ['play', 'pause', 'seeked']) p.addEventListener(type, () => syncComparison(true));
  p.addEventListener('frame', () => syncComparison());
  p.addEventListener('loading', () => {
    void safe(closeComparison)();
  });
  comparison.addEventListener('dblclick', event => {
    event.preventDefault();
    event.stopPropagation();
    api?.toggleMaximizeWindow();
  });
  new ResizeObserver(() => {
    if (b && !comparison.hidden) {
      const r = comparison.getBoundingClientRect();
      const scale = Math.min(r.width / b.videoWidth, r.height / b.videoHeight) * (devicePixelRatio || 1);
      if (scale > 0 && Number.isFinite(scale)) b.setOutputTarget(b.videoWidth * scale, b.videoHeight * scale);
    }
  }).observe(comparison);
  new MutationObserver(() => {
    if (b && state.cleanMode) exitClean();
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  const scope = document.createElement('section');
  scope.className = 'scope-panel';
  scope.hidden = true;
  scope.innerHTML = `<header><b id="scopeTitle">视频示波器</b><button>关闭</button></header>
    <div class="scope-tabs" role="group" aria-label="示波器类型"></div><div class="scope-options"><label>刻度 <select id="scopeUnits"><option value="ire">IRE 0–100</option><option value="code" selected>10-bit 0–1023</option></select></label><label>增益 <input id="scopeGain" type="range" min="0.5" max="4" value="1.5" step="0.1"></label><label><input id="scopeLog" type="checkbox">直方图对数</label></div>
    <canvas width="720" height="300" aria-label="视频信号分布"></canvas><small id="scopeInfo"></small>`;
  document.body.append(scope);
  const scopeButtons = new Map();
  for (const option of $('scopeMode').options) if (option.value !== 'off') {
    const button = document.createElement('button');button.type='button';button.textContent=option.textContent;
    button.dataset.scope=option.value;button.setAttribute('aria-pressed','false');
    button.onclick=()=>{$('scopeMode').value=option.value;$('scopeMode').onchange();};
    scope.querySelector('.scope-tabs').append(button);scopeButtons.set(option.value,button);
  }
  const scopePreferenceKey='astria.scope.lastMode';
  let lastScopeMode='waveform';
  try {const saved=localStorage.getItem(scopePreferenceKey);if(scopeButtons.has(saved))lastScopeMode=saved;} catch {}
  $('scopeOpen').onclick=()=>{
    $('scopeMode').value=lastScopeMode;
    $('scopeMode').onchange();
    $('scopeTool').open=false;
    $('reviewMenu').open=false;
    scopeButtons.get(lastScopeMode).focus();
  };
  scope.querySelector('button').onclick = () => { $('scopeMode').value = 'off'; scope.hidden = true; };
  scope.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Escape') scope.querySelector('button').click(); });
  $('scopeMode').onchange = () => {
    scope.hidden = $('scopeMode').value === 'off';
    if(!scope.hidden && scopeButtons.has($('scopeMode').value)){
      lastScopeMode=$('scopeMode').value;
      try {localStorage.setItem(scopePreferenceKey,lastScopeMode);} catch {}
    }
    for (const [mode,button] of scopeButtons) button.setAttribute('aria-pressed',String(mode===$('scopeMode').value));
    lastScope = 0; renderScope();
  };

  for (const id of ['scopeUnits','scopeGain','scopeLog']) $(id).oninput = () => { lastScope = 0; renderScope(true); };
  const sample = document.createElement('canvas');
  const ctx = sample.getContext('2d');
  let lastScope = 0, scopeRefreshTimer, sampleRevision=0;
  function axisLevel(v){return Math.round(v*($('scopeUnits').value==='ire'?100:1023));}
  const vectorTrace=document.createElement('canvas');vectorTrace.width=vectorTrace.height=280;
  const waveTrace=document.createElement('canvas');waveTrace.width=512;waveTrace.height=256;
  let scopeGpu=null;
  try {scopeGpu=window.createScopeGpu();} catch(error){console.warn('Scope GPU unavailable',error);}
  function gpuTrace(mode,w,h,gain){
    if(!scopeGpu){scope.dataset.renderer='cpu';return null;}
    try {const result=scopeGpu.render(sample,mode,w,h,gain,sampleRevision);scope.dataset.renderer='gpu';return result;}
    catch(error){console.warn('Scope GPU fallback',error);scopeGpu=null;scope.dataset.renderer='cpu';return null;}
  }
  function gainValue(){return Number($('scopeGain').value);}
  function renderVectorscope(g,readPixels,gain){
    // Rec.709 non-linear display RGB -> Cb/Cr. Positive Cr points upwards,
    // positive Cb rightwards: red upper-left, blue lower-right, green lower-left.
    const cx=360,cy=150,radius=126;
    const resolution=g.canvas.width/720,size=Math.max(280,Math.round(280*resolution)),center=size/2;
    const traceScale=size/280;
    if(vectorTrace.width!==size){vectorTrace.width=vectorTrace.height=size;}
    const gpu=gpuTrace(3,size,size,gain);
    const pixels=gpu?null:readPixels();
    const density=gpu?null:new Uint32Array(size*size);
    const rgbSums=gpu?null:new Float32Array(size*size*3);
    const chroma=(r,g,b)=>{const y=.2126*r+.7152*g+.0722*b;return [(b-y)/1.8556,(r-y)/1.5748];};
    let peakSaturation=0;
    for(let i=0;pixels && i<pixels.length;i+=4){
      const [cb,cr]=chroma(pixels[i]/255,pixels[i+1]/255,pixels[i+2]/255);
      peakSaturation=Math.max(peakSaturation,Math.hypot(cb,cr));
      const x=Math.round(center+cb*2*radius*traceScale),y=Math.round(center-cr*2*radius*traceScale);
      if(x>=0&&x<size&&y>=0&&y<size){
        const bin=y*size+x;density[bin]++;
        for(let k=0;k<3;k++)rgbSums[bin*3+k]+=pixels[i+k]/255;
      }
    }
    g.fillStyle='#050606';g.fillRect(0,0,720,300);
    g.lineWidth=1;g.font='11px "Segoe UI", "Microsoft YaHei", sans-serif' ;g.textAlign='center';g.textBaseline='middle';
    for(const ratio of [1]){g.strokeStyle='#55513a';g.beginPath();g.arc(cx,cy,radius*ratio,0,Math.PI*2);g.stroke();}
    g.strokeStyle='#494329';g.beginPath();g.moveTo(cx-radius,cy);g.lineTo(cx+radius,cy);g.moveTo(cx,cy-radius);g.lineTo(cx,cy+radius);g.stroke();
    g.strokeStyle='#55513a';
    for(let degree=0;degree<360;degree+=5){
      const angle=degree*Math.PI/180,inner=radius-(degree%30===0?10:degree%10===0?6:3);
      g.beginPath();g.moveTo(cx+Math.cos(angle)*inner,cy+Math.sin(angle)*inner);
      g.lineTo(cx+Math.cos(angle)*radius,cy+Math.sin(angle)*radius);g.stroke();
    }
    const skin=57*Math.PI/180;
    g.save();g.setLineDash([4,4]);g.strokeStyle='#9a8064';g.beginPath();g.moveTo(cx,cy);g.lineTo(cx-Math.cos(skin)*radius,cy-Math.sin(skin)*radius);g.stroke();g.restore();
    const trace=vectorTrace;
    if(!gpu){
    const ctx=trace.getContext('2d'),image=ctx.createImageData(size,size);
    for(let i=0;i<density.length;i++){
      const count=density[i];if(!count)continue;
      const at=i*4, rgb=[0,1,2].map(k=>rgbSums[i*3+k]/count);
      const peak=Math.max(...rgb,.001);
      const exposure=Math.log1p(count*traceScale*traceScale)*gain*.22;
      const strength=-Math.expm1(-exposure);
      // Preserve sampled hue; only dense overlapping traces approach white.
      const core=Math.max(0,(strength-.65)/.35)*.7;
      for(let k=0;k<3;k++)image.data[at+k]=Math.round(255*(rgb[k]/peak*(1-core)+core));
      image.data[at+3]=Math.round(255*strength);
    }
    ctx.putImageData(image,0,0);
    }
    g.drawImage(gpu||trace,cx-140,cy-140,280,280);
    const targets=[['R',1,0,0,'#e77b7b'],['Mg',1,0,1,'#cc87d9'],['B',0,0,1,'#7b9bea'],['Cy',0,1,1,'#79cbd0'],['G',0,1,0,'#82c98d'],['Yl',1,1,0,'#d4c778']];
    for(const [name,r,green,b] of targets){
      const [cb,cr]=chroma(r,green,b),x=cx+cb*2*radius*.75,y=cy-cr*2*radius*.75;
      g.strokeStyle='#81743a';g.fillStyle='#a18f46';
      g.beginPath();for(const sx of [-1,1])for(const sy of [-1,1]){
        g.moveTo(x+sx*4,y+sy*7);g.lineTo(x+sx*7,y+sy*7);g.lineTo(x+sx*7,y+sy*4);
      }g.stroke();g.fillText(name,x+12,y+9);
    }
    $('scopeTitle').textContent='Vectorscope · 矢量示波器';
    $('scopeInfo').textContent=`Rec.709 SDR 显示信号 · Cb/Cr 全范围 · ${sample.width}×${sample.height} 采样 · ${gpu?'':`峰值色度 ${(peakSaturation*200).toFixed(1)}% · `}肤色线仅作色相参考`;
  }
  function renderScope(reuseSample=false) {
    if (scope.hidden || !p.readyState) return;
    const now = performance.now(); if (now - lastScope < 120) return; lastScope = now;
    try {
      const isWave=['waveform','rgb-waveform','parade'].includes($('scopeMode').value);
      const sw = scopeGpu?Math.min(1920,p.videoWidth):isWave?Math.min(1024,Math.max(512,Math.round(scope.querySelector('canvas').clientWidth*(devicePixelRatio||1)))):512;
      const sh = Math.max(1, Math.min(scopeGpu?1080:isWave?576:512, Math.round(sw * p.videoHeight / p.videoWidth)));
      const redraw=reuseSample!==true||!p.paused||sampleRevision===0||sample.width!==sw||sample.height!==sh;
      if (sample.width !== sw || sample.height !== sh) { sample.width = sw; sample.height = sh; }
      ctx.filter = state.lumaMode && state.colorPreset === 'original' ? `grayscale(1) contrast(${state.lumaContrast})` : 'none';
      if(redraw){ctx.drawImage(source(),0,0,sw,sh);sampleRevision++;}
      // GPU trace consumes the canvas directly; CPU readback is lazy and fallback-only.
      let pixels=null;
      const readPixels=()=>pixels||(pixels=ctx.getImageData(0,0,sw,sh).data);

      const canvas = scope.querySelector('canvas'), g = canvas.getContext('2d');
      // Draw labels/grid at physical pixel resolution while retaining logical coordinates
      // and the existing low-resolution density trace appearance.
      const bounds=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
      const pixelWidth=Math.max(1,Math.round(bounds.width*dpr));
      const pixelHeight=Math.max(1,Math.round(bounds.width*300/720*dpr));
      if(canvas.width!==pixelWidth||canvas.height!==pixelHeight){canvas.width=pixelWidth;canvas.height=pixelHeight;}
      g.setTransform(pixelWidth/720,0,0,pixelHeight/300,0,0);

      const mode = $('scopeMode').value, histogram = mode === 'histogram', parade = mode === 'parade';
      $('scopeUnits').closest('label').hidden=mode==='vectorscope';
      $('scopeLog').closest('label').hidden=!histogram;
      $('scopeGain').closest('label').hidden=histogram;
      if(mode==='vectorscope'){$('scopeGain').disabled=false;renderVectorscope(g,readPixels,gainValue());return;}
      const left = 48, top = 22, width = 648, height = 248, gain = Number($('scopeGain').value);
      const colors = [[255,45,45],[35,255,65],[65,100,255]], names = ['R','G','B'];
      const bins = Array.from({length:3},()=>new Uint32Array(256));
      const traceWidth=Math.max(1,Math.round(width*pixelWidth/720/(parade?3:1)));
      const traceHeight=Math.max(2,Math.round(height*pixelHeight/300));
      const gpu=histogram?null:gpuTrace(mode==='waveform'?0:parade?2:1,width*pixelWidth/720,traceHeight,gain);
      if(!gpu)readPixels();
      const density = gpu?[]:Array.from({length:mode==='waveform'?1:3},()=>new Float32Array(traceWidth*traceHeight));
      // Deposit into adjacent vertical bins for subpixel coverage, without blur or jitter.
      const deposit=(channel,x,value)=>{
        const y=(1-value/255)*(traceHeight-1),lo=Math.floor(y),fraction=y-lo;
        channel[lo*traceWidth+x]+=1-fraction;
        if(lo+1<traceHeight)channel[(lo+1)*traceWidth+x]+=fraction;
      };
      const minima=[255,255,255], maxima=[0,0,0];
      for(let i=0;pixels && i<pixels.length;i+=4){
        const x=Math.min(traceWidth-1,Math.floor(((i/4)%sw)*traceWidth/sw));
        for(let k=0;k<3;k++){const v=pixels[i+k];bins[k][v]++;minima[k]=Math.min(minima[k],v);maxima[k]=Math.max(maxima[k],v);if(!histogram && mode!=='waveform')deposit(density[k],x,v);}
        if(mode==='waveform'){const y=.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2];deposit(density[0],x,y);}
      }
      g.fillStyle='#050606';g.fillRect(0,0,720,300);
      g.font='11px "Segoe UI", "Microsoft YaHei", sans-serif';g.textBaseline='middle';g.lineWidth=1;
      let peak=1;for(const channel of bins)for(const count of channel)peak=Math.max(peak,count);
      const log=$('scopeLog').checked;
      $('scopeGain').disabled=histogram; $('scopeLog').disabled=!histogram;
      g.strokeStyle='#494329';g.fillStyle='#a18f46';
      if(!histogram){
        for(let n=0;n<=8;n++){
          const code=n===8?1023:n*128,level=code/1023,y=top+(1-level)*height;
          g.setLineDash(n===4?[3,3]:[]);g.beginPath();g.moveTo(left,y);g.lineTo(left+width,y);g.stroke();
          g.textAlign='right';g.fillText($('scopeUnits').value==='code'?code:Math.round(level*100),left-8,y);
        }
        g.setLineDash([]);
        for(let n=0;n<=64;n++){const x=left+n*width/64;g.beginPath();g.moveTo(x,top+height);g.lineTo(x,top+height+(n%8===0?5:3));g.stroke();}
      }
      if(histogram){
        g.textAlign='center';
        for(let n=0;n<=10;n++){
          const x=left+n*width/10;g.beginPath();g.moveTo(x,top);g.lineTo(x,top+height);g.stroke();
          g.fillText(axisLevel(n/10),x,top-12);
        }
        // Resolve-style stacked RGB distributions with one shared count scale.
        for(let k=0;k<3;k++){
          const color=colors[k],base=top+(k+1)*height/3,band=height/3-5;
          g.strokeStyle=`rgb(${color})`;g.fillStyle=`rgba(${color},.20)`;g.beginPath();g.moveTo(left,base);
          bins[k].forEach((count,v)=>{const strength=log?Math.log1p(count)/Math.log1p(peak):count/peak;g.lineTo(left+v/255*width,base-strength*band);});
          g.lineTo(left+width,base);g.closePath();g.fill();g.stroke();
        }
      }else{
        if(gpu){g.drawImage(gpu,left,top,width,height);}else{
        const trace=waveTrace;
        if(trace.width!==traceWidth||trace.height!==traceHeight){trace.width=traceWidth;trace.height=traceHeight;}
        const t=trace.getContext('2d');
        const exposure= gain*.16 * 288/Math.max(1,sh*sw/traceWidth);
        g.save();g.globalCompositeOperation='screen';
        for(let k=0;k<density.length;k++){
          const image=t.createImageData(traceWidth,traceHeight),color=mode==='waveform'?[225,235,228]:colors[k];
          for(let j=0;j<density[k].length;j++){const count=density[k][j];if(!count)continue;const at=j*4;image.data[at]=color[0];image.data[at+1]=color[1];image.data[at+2]=color[2];image.data[at+3]=Math.round(255*-Math.expm1(-count*exposure));}
          t.putImageData(image,0,0);g.drawImage(trace,left+(parade?k*width/3:0),top,parade?width/3:width,height);
        }g.restore();
        }
      }
      $('scopeTitle').textContent = scopeButtons.get(mode).textContent;
      const scale=$('scopeUnits').value==='ire'?100:1023;
      $('scopeInfo').textContent = `SDR 显示信号 · 全范围 · ${sw}×${sh} 采样 · `+(gpu?'GPU 密度轨迹':names.map((name,k)=>`${name} ${axisLevel(minima[k]/255)}–${axisLevel(maxima[k]/255)}`).join(' / '));
      
    } catch {scope.hidden=true;toast('当前画面无法分析');}
  }
  p.addEventListener('frame', renderScope);
  p.addEventListener('pause',()=>{
    clearTimeout(scopeRefreshTimer);
    if(!scope.hidden)scopeRefreshTimer=setTimeout(()=>{lastScope=0;renderScope();},160);
  });
  function timeLabel(value) {
    const seconds = Math.floor(Math.max(0, Number(value) || 0));
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
      .map((n) => String(n).padStart(2, '0'))
      .join(':');
  }
  p.addEventListener('seeked', () =>
    notice(
      `${timeLabel(p.currentTime)} / ${timeLabel(p.duration)} · ${Math.round(p.duration ? (p.currentTime / p.duration) * 100 : 0)}%`,
    ),
  );
  p.addEventListener('volumechange', () => notice(p.muted ? '静音' : `音量 ${Math.round(p.volume * 100)}%`));
  return {
    notice,
    closeComparison,
    refreshTracks,
    refreshScope() {
      clearTimeout(scopeRefreshTimer);
      if (!scope.hidden) scopeRefreshTimer = setTimeout(() => { lastScope = 0; renderScope(); }, 160);
    },
    get scopePerformance() { return scopeGpu?.getStats()||null; },
    get comparison() {
      return b;
    },
  };
};
