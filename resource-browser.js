(() => {
  const api = window.desktopAPI;
  const iconPaths = {
    back: 'M14 6l-6 6 6 6', forward: 'M10 6l6 6-6 6', up: 'M6 10l6-6 6 6M12 4v16',
    down: 'M6 14l6 6 6-6M12 20V4', chevron: 'M9 6l6 6-6 6', expanded: 'M6 9l6 6 6-6',
    folder: 'M3 7V5a1 1 0 0 1 1-1h6l2 3h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7z',
    video: 'M5 3h10l4 4v14H5zM14 3v5h5M9 11l5 3-5 3z',
    playing: 'M6 9v6M10 5v14M14 8v8M18 6v12',
    computer: 'M3 4h18v13H3zM8 21h8M12 17v4',
    refresh: 'M20 7v5h-5M20 12a8 8 0 1 0-2 6',
    locate: 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    close: 'M6 6l12 12M18 6 6 18', previous: 'M5 5v14M18 5l-9 7 9 7z', next: 'M19 5v14M6 5l9 7-9 7z'
  };
  function makeIcon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('aria-hidden','true');
    const path = document.createElementNS(svg.namespaceURI,'path'); path.setAttribute('d',iconPaths[name]);
    svg.append(path);
    if (name === 'locate') {
      const dot = document.createElementNS(svg.namespaceURI,'circle');
      dot.setAttribute('cx','12'); dot.setAttribute('cy','12'); dot.setAttribute('r','2.5');
      dot.setAttribute('fill','currentColor'); dot.setAttribute('stroke','none');
      svg.append(dot);
    }
    return svg;
  }
  function decorate(button, icon, text = '') {
    button.replaceChildren(makeIcon(icon));
    if(text) { const label = document.createElement('span'); label.textContent = text; button.append(label); }
    else button.setAttribute('aria-label',button.title || button.getAttribute('aria-label'));
  }
  let panel, openVideo, mediaPath = null, current = null, history = [], cursor = -1, ticket = 0, selected = null;
  const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
  const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
  const directoryOf = file => file.slice(0, file.lastIndexOf('\\') + 1);
  const $ = id => panel.querySelector(`#${id}`);
  let filtered = [], ascending = true, expanded = new Map(), children = new Map();
  const storageKey = 'astria.resourceBrowser.v1';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(storageKey)) || {}; } catch {}
  let split = Math.max(25, Math.min(70, Number(saved.split) || 38));
  ascending = saved.ascending !== false;
  if (Array.isArray(saved.expanded)) expanded = new Map(saved.expanded.filter(path=>typeof path==='string').map(path=>[path,true]));
  function remember() {
    try { localStorage.setItem(storageKey, JSON.stringify({ path: current?.path ?? saved.path, split, ascending, expanded: [...expanded.keys()].slice(-200) })); } catch {}
  }
  function revealSelected(focus = false) {
    const index = filtered.findIndex(item=>same(item.path,selected));
    if(index < 0) return;
    const list = $('resourceList');
    if(index*36 < list.scrollTop) list.scrollTop = index*36;
    else if((index+1)*36 > list.scrollTop+list.clientHeight) list.scrollTop = (index+1)*36-list.clientHeight;
    renderRows();
    if(focus) [...list.querySelectorAll('.resource-entry')].find(row=>same(row.dataset.path,selected))?.focus({preventScroll:true});
  }
  function render(resetScroll = true) {
    const query = $('resourceSearch').value.trim().toLowerCase();
    filtered = (current?.entries || []).filter(item => !item.directory && item.name.toLowerCase().includes(query))
      .sort((a,b) => (ascending ? 1 : -1) * collator.compare(a.name,b.name));
    renderTree();
    if(resetScroll) $('resourceList').scrollTop = 0;
    renderRows();
    $('resourceStatus').textContent = `${filtered.length} 个视频 · ${(current?.entries || []).filter(item=>item.directory).length} 个子文件夹`;
    $('resourceBack').disabled = cursor <= 0;
    $('resourceForward').disabled = cursor >= history.length - 1;
    $('resourceUp').disabled = !current || current.parent === null;
    const videos = filtered.filter(item=>!item.directory), index = videos.findIndex(item=>same(item.path,mediaPath));
    $('resourcePrevious').disabled = index <= 0;
    $('resourceNext').disabled = index < 0 || index >= videos.length - 1;
  }
  // Only create rows near the viewport, even for folders containing thousands of files.
  function renderRows() {
    const list = $('resourceList'), top = list.scrollTop;
    const focused = list.contains(document.activeElement) ? document.activeElement.dataset.path : null;
    const start = Math.max(0, Math.floor(top / 36) - 5), end = Math.min(filtered.length, start + Math.ceil((list.clientHeight || 480) / 36) + 12);
    const fragment = document.createDocumentFragment();
    const spacer = height => { const node = document.createElement('div'); node.style.height = `${height}px`; return node; };
    fragment.append(spacer(start * 36));
    filtered.slice(start,end).forEach(item => {
      const row = document.createElement('button'); row.type = 'button'; row.className = 'resource-entry';
      row.classList.toggle('selected',same(item.path,selected)); row.classList.toggle('playing',same(item.path,mediaPath)); row.style.paddingLeft = `${8 + (item.depth || 0) * 16}px`;
      row.dataset.path = item.path; row.tabIndex = same(item.path,selected || filtered[0]?.path) ? 0 : -1;
      row.title = item.path; row.setAttribute('aria-label',`${item.directory ? '文件夹' : '视频'} ${item.name}${same(item.path,mediaPath) ? '，当前播放' : ''}`);
      const icon = document.createElement('span'); icon.className = 'resource-entry-icon'; icon.append(makeIcon(same(item.path,mediaPath) ? 'playing' : 'video'));
      const name = document.createElement('span'); name.textContent = item.name;
      row.append(icon,name);
      row.onclick = event => {
        if(item.directory && event.offsetX < 28) { void toggleFolder(item); return; }
        selected = item.path; list.querySelectorAll('.resource-entry').forEach(node=>node.tabIndex=node===row?0:-1); list.querySelectorAll('.resource-entry').forEach(node=>node.classList.remove('selected')); row.classList.add('selected');
      };
      row.ondblclick = () => activate(item);
      row.onkeydown = event => { if(event.key === 'Enter'){event.preventDefault();activate(item);} };
      fragment.append(row);
    });
    fragment.append(spacer((filtered.length - end) * 36));
    list.replaceChildren(fragment);
    if(focused) {
      const replacement = [...list.querySelectorAll('.resource-entry')].find(row=>same(row.dataset.path,focused));
      (replacement || list).focus({preventScroll:true});
    }
  }
  let treeRoot = null;
  function renderTree() {
    if (!treeRoot) return;
    const container = $('resourceTree'), scroll = container.scrollTop, horizontal = container.scrollLeft;
    const fragment = document.createDocumentFragment();
    function append(item, depth) {
      const row = document.createElement('div'); row.className = 'resource-tree-row';
      row.style.paddingLeft = `${depth * 10}px`;
      const arrow = document.createElement('button'); arrow.type = 'button';
      arrow.append(makeIcon(expanded.get(item.path) ? 'expanded' : 'chevron'));
      arrow.setAttribute('aria-label', `${expanded.get(item.path) ? '折叠' : '展开'} ${item.name}`);
      arrow.setAttribute('aria-expanded', String(!!expanded.get(item.path)));
      arrow.onclick = () => void toggleFolder(item);
      const label = document.createElement('button'); label.type = 'button'; label.textContent = item.name; label.title = item.path || '此电脑';
      label.replaceChildren(); const folderName = document.createElement('span'); folderName.textContent = item.name; label.append(makeIcon(item.path === '' ? 'computer' : 'folder'),folderName);
      label.className = 'resource-tree-label'; label.classList.toggle('selected', item.path === current?.path);
      label.onclick = () => void navigate(item.path);
      row.append(arrow,label); fragment.append(row);
      if (expanded.get(item.path)) (children.get(item.path) || []).filter(child=>child.directory)
        .slice().sort((a,b)=>collator.compare(a.name,b.name)).forEach(child=>append(child,depth+1));
    }
    append(treeRoot,0); container.replaceChildren(fragment); container.scrollTop = scroll; container.scrollLeft = horizontal;
  }
  async function toggleFolder(item) {
    if (expanded.get(item.path)) { expanded.delete(item.path); remember(); renderTree(); return; }
    if (!children.has(item.path)) {
      try { const result = await api.browseDirectory(item.path); children.set(item.path, result.entries.sort((a,b) => Number(b.directory)-Number(a.directory) || collator.compare(a.name,b.name))); }
      catch { $('resourceStatus').textContent = '无法展开此目录，请检查访问权限或磁盘连接'; return; }
    }
    expanded.set(item.path, true); remember(); renderTree();
  }
  function activate(item) { if(item.directory) void navigate(item.path); else openVideo(item.path); }
  async function navigate(path, historyIndex = null, options = {}) {
    const request = ++ticket;
    $('resourceStatus').textContent = '正在读取文件夹…';
    panel.setAttribute('aria-busy','true');
    try {
      const result = await api.browseDirectory(path);
      if(request !== ticket) return;
      const preserve = same(current?.path,result.path) && !options.locate;
      current = result; if(!preserve) selected = null;
      children.set(result.path, result.entries);
      if (!treeRoot || (treeRoot.path !== '' && !(result.path.toLowerCase() === treeRoot.path.toLowerCase() || result.path.toLowerCase().startsWith(treeRoot.path.toLowerCase().replace(/[\\/]+$/, '') + '\\')))) {
        treeRoot = {path: result.path, name: result.path || '此电脑', directory: true};
      }
      expanded.set(result.path, true);
      if(historyIndex !== null) cursor = historyIndex;
      else if(history[cursor] !== result.path) { history = history.slice(0,cursor+1); history.push(result.path); cursor = history.length-1; }
      $('resourcePath').value = result.path || '此电脑';
      if(!preserve) $('resourceSearch').value = '';
      if(options.refresh) children.clear();
      children.set(result.path,result.entries);
      async function restoreExpanded(entries, depth = 0) {
        if(depth >= 32 || request !== ticket) return;
        for(const folder of entries.filter(item=>item.directory && expanded.has(item.path))) {
          try {
            const child = await api.browseDirectory(folder.path);
            if(request !== ticket) return;
            children.set(folder.path,child.entries);
            await restoreExpanded(child.entries,depth+1);
          } catch {}
        }
      }
      await restoreExpanded(result.entries);
      if(request !== ticket) return;
      render(!preserve); remember();
      if(options.locate) { selected = mediaPath; revealSelected(); }
    } catch {
      if(request === ticket) $('resourceStatus').textContent = '无法读取目录，请检查路径、权限或磁盘连接后重试。';
    } finally { if(request === ticket) panel.setAttribute('aria-busy','false'); }
  }
  function show(open) {
    panel.hidden = !open;
    document.getElementById('toggleResourceBrowser').setAttribute('aria-pressed',String(open));
    if(open && !current) void navigate(saved.path ?? (mediaPath ? directoryOf(mediaPath) : null));
    else if(open) renderRows();
  }
  window.videoResourceBrowser = {
    setMedia(path) {
      mediaPath = path;
      if(!panel || panel.hidden) return;
      if(path && same(current?.path.replace(/[\\/]+$/, ''), directoryOf(path).replace(/[\\/]+$/, ''))) render(false);
      else if(path) void navigate(directoryOf(path)); else render(false);
    },
    init(handler) {
      openVideo = handler;
      const toggle = document.getElementById('toggleResourceBrowser');
      if(!api?.browseDirectory) { toggle.hidden = true; return; }
      panel = document.createElement('aside'); panel.className = 'resource-browser'; panel.hidden = true; panel.setAttribute('aria-label','视频资源浏览器');
      panel.innerHTML = `<header><strong>视频资源</strong><button id="resourceLocate" title="定位当前播放文件夹">定位</button><button id="resourceClose" aria-label="关闭资源浏览器">×</button></header>
        <nav aria-label="目录导航"><button id="resourceBack" title="后退">‹</button><button id="resourceForward" title="前进">›</button><button id="resourceUp" title="上一层">↑</button><button id="resourceDrives" title="磁盘列表">此电脑</button><button id="resourceChoose" title="选择文件夹">打开目录</button><button id="resourceRefresh" title="刷新">↻</button></nav>
        <input id="resourcePath" aria-label="文件夹路径，输入后按 Enter" placeholder="输入文件夹路径，Enter 打开">
        <div class="resource-filter"><input id="resourceSearch" aria-label="搜索当前目录" placeholder="搜索当前目录"><button id="resourceSort" title="按名称自然排序，点击切换升降序">名称 ↑</button></div>
        <div class="resource-columns"><section class="resource-folders"><small>文件夹</small><div id="resourceTree" aria-label="文件夹目录树"></div></section><div id="resourceDivider" role="separator" tabindex="0" aria-label="调整文件夹栏宽度" aria-orientation="vertical" aria-valuemin="25" aria-valuemax="70" aria-valuenow="38" title="拖动调整宽度，双击恢复"></div><section class="resource-videos"><small>当前目录的视频</small><div id="resourceList" aria-label="视频列表"></div></section></div><footer><span id="resourceStatus" role="status"></span><div class="resource-playback"><button id="resourcePrevious" title="按当前列表顺序播放上一部">上一部</button><button id="resourceNext" title="按当前列表顺序播放下一部">下一部</button></div></footer>`;
      document.body.append(panel);
      for(const [id,icon,text] of [
        ['resourceBack','back'],['resourceForward','forward'],['resourceUp','up'],
        ['resourceDrives','computer','此电脑'],['resourceChoose','folder','打开目录'],
        ['resourceRefresh','refresh'],['resourceLocate','locate','定位'],['resourceClose','close'],
        ['resourcePrevious','previous','上一部'],['resourceNext','next','下一部'],['resourceSort','up','名称']
      ]) decorate($(id),icon,text);
      const divider = $('resourceDivider'), columns = panel.querySelector('.resource-columns');
      let dividerDrag = null;
      const setSplit = value => {
        split = Math.max(25,Math.min(70,value));
        columns.style.setProperty('--folder-share', `${split}%`);
        divider.setAttribute('aria-valuenow',String(Math.round(split)));
        remember();
      };
      setSplit(split);
      divider.addEventListener('pointerdown',event=>{
        if(event.button !== 0)return;
        event.preventDefault();
        dividerDrag = { pointerId: event.pointerId, startX: event.clientX, startSplit: split };
        divider.setPointerCapture(event.pointerId);
        columns.classList.add('resizing');
      });
      divider.addEventListener('pointermove',event=>{
        if(!dividerDrag || dividerDrag.pointerId !== event.pointerId || !divider.hasPointerCapture(event.pointerId))return;
        const bounds = columns.getBoundingClientRect();
        if(bounds.width > 0) setSplit(dividerDrag.startSplit + (event.clientX-dividerDrag.startX)/bounds.width*100);
      });
      divider.addEventListener('pointerup',event=>{if(divider.hasPointerCapture(event.pointerId))divider.releasePointerCapture(event.pointerId);});
      const endDividerDrag = () => { dividerDrag = null; columns.classList.remove('resizing'); };
      divider.addEventListener('lostpointercapture',endDividerDrag);
      divider.addEventListener('pointercancel',endDividerDrag);
      divider.addEventListener('dblclick',()=>setSplit(38));
      divider.addEventListener('keydown',event=>{
        if(event.key==='ArrowLeft'||event.key==='ArrowRight') {event.preventDefault();setSplit(split+(event.key==='ArrowLeft'?-5:5));}
      });
      toggle.onclick = () => show(panel.hidden);
      $('resourceClose').onclick = () => show(false);
      for(const [id,delta] of [['resourcePrevious',-1],['resourceNext',1]]) $(id).onclick = () => {
        const videos = filtered.filter(item=>!item.directory), index = videos.findIndex(item=>same(item.path,mediaPath));
        if(index >= 0 && videos[index+delta]) openVideo(videos[index+delta].path);
      };
      $('resourceLocate').onclick = () => void navigate(mediaPath ? directoryOf(mediaPath) : null, null, {locate:true});
      $('resourceDrives').onclick = () => void navigate('');
      $('resourceBack').onclick = () => { if(cursor>0) void navigate(history[cursor-1],cursor-1); };
      $('resourceForward').onclick = () => { if(cursor<history.length-1) void navigate(history[cursor+1],cursor+1); };
      $('resourceUp').onclick = () => { if(current?.parent !== null && current) void navigate(current.parent); };
      $('resourceRefresh').onclick = () => void navigate(current?.path ?? null, null, {refresh:true});
      $('resourceChoose').onclick = async () => { try { const path = await api.chooseDirectory(); if(path) await navigate(path); } catch { $('resourceStatus').textContent = '无法打开文件夹选择器'; } };
      $('resourcePath').onkeydown = event => { if(event.key === 'Enter') {event.stopPropagation(); void navigate(event.target.value.trim());} };
      $('resourceSearch').oninput = render;
      $('resourceSort').onclick = () => { ascending = !ascending; decorate($('resourceSort'),ascending ? 'up' : 'down','名称'); render(); remember(); };
      $('resourceList').tabIndex = 0;
      $('resourceList').addEventListener('keydown',event=>{
        if(event.key==='Enter' && event.target===$('resourceList')) {
          const item = filtered.find(item=>same(item.path,selected));
          if(item) { event.preventDefault(); activate(item); }
          return;
        }
        if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key) || !filtered.length) return;
        event.preventDefault();
        const index = filtered.findIndex(item=>same(item.path,selected));
        const next = event.key==='Home' ? 0 : event.key==='End' ? filtered.length-1 : Math.max(0,Math.min(filtered.length-1,index+(event.key==='ArrowDown'?1:-1)));
        selected = filtered[next].path; revealSelected(true);
      });
      $('resourceList').addEventListener('scroll',renderRows,{passive:true});
      panel.addEventListener('keydown',event => {
        event.stopPropagation();
        if(event.key === 'Escape') { event.preventDefault(); show(false); toggle.focus(); }
      });
      new ResizeObserver(()=>{if(!panel.hidden && current)renderRows();}).observe($('resourceList'));
    }
  };
})();
