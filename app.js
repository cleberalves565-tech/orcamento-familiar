:root{
  --bg:#0b1220; --sidebar:#0e1626; --card:#141f33; --card2:#182238;
  --border:#223049; --text:#e6ecf5; --text2:#93a2ba; --text3:#5c6b85;
  --accent:#3b82f6; --accent2:#60a5fa; --green:#22c55e; --red:#ef4444;
  --amber:#f59e0b; --pink:#ec4899; --purple:#a78bfa;
  --radius:10px;
}
*{box-sizing:border-box; margin:0; padding:0;}
body{
  background:var(--bg); color:var(--text); font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  font-size:14px; line-height:1.5;
}
.app{display:flex; min-height:100vh;}
.sidebar{
  width:230px; background:var(--sidebar); border-right:1px solid var(--border);
  padding:20px 14px; flex-shrink:0; position:sticky; top:0; height:100vh; overflow-y:auto;
}
.brand{display:flex; align-items:center; gap:10px; padding:0 6px 20px;}
.brand-icon{width:34px; height:34px; border-radius:8px; background:var(--accent); display:flex; align-items:center; justify-content:center; font-weight:700; color:#fff;}
.brand-name{font-weight:700; font-size:15px;}
.brand-sub{font-size:11px; color:var(--text2);}
.nav-item{
  display:flex; align-items:center; gap:10px; padding:9px 10px; border-radius:8px;
  color:var(--text2); cursor:pointer; font-size:13.5px; margin-bottom:2px; border:none; background:none; width:100%; text-align:left;
}
.nav-item svg{flex-shrink:0; opacity:.85;}
.nav-item:hover{background:var(--card); color:var(--text);}
.nav-item.active{background:var(--accent); color:#fff;}
.nav-item.active svg{opacity:1;}
.nav-sep{height:1px; background:var(--border); margin:12px 0;}
.nav-foot{margin-top:20px; display:flex; flex-direction:column; gap:6px;}
.pill-btn{
  background:var(--card); border:1px solid var(--border); color:var(--text2);
  padding:7px 10px; border-radius:8px; font-size:12px; cursor:pointer; text-align:left;
}
.pill-btn:hover{color:var(--text); border-color:var(--accent);}
.pill-btn.danger{color:#f87171; border-color:#4c1d1d;}

.main{flex:1; padding:26px 34px 80px; max-width:1120px;}
.topbar{display:flex; justify-content:space-between; align-items:center; margin-bottom:22px;}
.topbar h1{font-size:20px; font-weight:600;}
.topbar .meta{font-size:12.5px; color:var(--text2); display:flex; gap:14px; align-items:center;}

.screen{display:none;}
.screen.active{display:block;}

.grid{display:grid; gap:14px;}
.grid-4{grid-template-columns:repeat(4,1fr);}
.grid-3{grid-template-columns:repeat(3,1fr);}
.grid-2{grid-template-columns:repeat(2,1fr);}
@media(max-width:900px){.grid-4,.grid-3,.grid-2{grid-template-columns:1fr 1fr;}}

.card{background:var(--card); border:1px solid var(--border); border-radius:var(--radius); padding:16px 18px;}
.stat-label{font-size:11.5px; color:var(--text2); text-transform:uppercase; letter-spacing:.04em; margin-bottom:6px;}
.stat-value{font-size:22px; font-weight:700;}
.stat-sub{font-size:11.5px; color:var(--text2); margin-top:4px;}
.up{color:var(--green);} .down{color:var(--red);}

.section-title{font-size:15px; font-weight:600; margin:24px 0 12px;}
.section-title:first-child{margin-top:0;}

.logic-note{
  border:1px dashed #2e4468; background:#101b2e; border-radius:8px; padding:10px 13px;
  font-size:12.5px; color:#8fb4e8; margin:10px 0 18px; display:flex; gap:8px;
}
.logic-note b{color:#bcd6fb;}

.row{display:flex; align-items:center; justify-content:space-between; padding:11px 0; border-bottom:1px solid var(--border);}
.row:last-child{border-bottom:none;}
.row-left{display:flex; align-items:center; gap:12px;}
.row-icon{width:36px; height:36px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:16px; background:var(--card2); flex-shrink:0;}
.row-title{font-weight:500; font-size:13.5px;}
.row-sub{font-size:12px; color:var(--text2);}
.row-value{font-weight:600; font-size:13.5px;}

.chip{display:inline-flex; align-items:center; gap:6px; background:var(--card2); border:1px solid var(--border); border-radius:100px; padding:5px 12px; font-size:12px; color:var(--text2); cursor:pointer;}
.chip.active{background:var(--accent); color:#fff; border-color:var(--accent);}

.btn{background:var(--accent); color:#fff; border:none; border-radius:8px; padding:9px 16px; font-size:13px; font-weight:600; cursor:pointer;}
.btn:hover{background:var(--accent2);}
.btn.ghost{background:transparent; border:1px solid var(--border); color:var(--text);}
.btn.danger{background:#3d1414; color:#f87171; border:1px solid #5c1e1e;}
.btn.sm{padding:6px 11px; font-size:12px;}

input,select{
  background:var(--card2); border:1px solid var(--border); color:var(--text);
  padding:9px 11px; border-radius:8px; font-size:13px; width:100%;
}
label{font-size:12px; color:var(--text2); display:block; margin-bottom:5px;}
.field{margin-bottom:14px;}
.field-row{display:flex; gap:12px;}
.field-row .field{flex:1;}

.progress{height:8px; background:var(--card2); border-radius:100px; overflow:hidden; margin-top:8px;}
.progress-fill{height:100%; border-radius:100px;}

.bars{display:flex; align-items:flex-end; gap:6px; height:120px; margin-top:10px;}
.bar-col{flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%; gap:4px;}
.bar{width:100%; border-radius:4px 4px 0 0;}
.bar-label{font-size:10px; color:var(--text3);}
.bar-value{font-size:9px; color:var(--text2); white-space:nowrap;}

.bars-zero{display:flex; align-items:stretch; gap:6px; height:160px; margin-top:10px;}
.bar-col-zero{flex:1; display:flex; flex-direction:column; align-items:center; height:100%; gap:4px;}
.bar-zero-top{flex:1; width:100%; display:flex; flex-direction:column; justify-content:flex-end; align-items:center;}
.bar-zero-axis{width:100%; height:1px; background:var(--border); flex-shrink:0;}
.bar-zero-bottom{flex:1; width:100%; display:flex; flex-direction:column; justify-content:flex-start; align-items:center;}
.bar-d{width:70%; border-radius:3px;}

.donut{width:120px; height:120px; border-radius:50%; flex-shrink:0;}
.legend{display:flex; flex-direction:column; gap:8px; font-size:12px;}
.legend-item{display:flex; align-items:center; gap:8px;}
.legend-dot{width:9px; height:9px; border-radius:50%; flex-shrink:0;}

.overlay{
  display:none; position:absolute; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,.6);
  align-items:flex-start; justify-content:center; z-index:50; padding:40px 16px;
}
.overlay.active{display:flex;}
.modal{background:var(--card); border:1px solid var(--border); border-radius:14px; padding:22px; width:440px; max-width:100%;}
.modal-head{display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;}
.modal-head h3{font-size:16px; font-weight:600;}
.close-x{background:none; border:none; color:var(--text2); cursor:pointer; font-size:18px;}

.toggle{position:relative; width:42px; height:24px; background:var(--card2); border:1px solid var(--border); border-radius:100px; cursor:pointer; flex-shrink:0;}
.toggle .knob{position:absolute; top:2px; left:2px; width:18px; height:18px; border-radius:50%; background:var(--text2); transition:.15s;}
.toggle.on{background:var(--accent);}
.toggle.on .knob{left:20px; background:#fff;}

.banner{border-radius:10px; padding:12px 16px; font-size:12.5px; margin-bottom:16px; display:flex; gap:10px; align-items:flex-start;}
.banner.warn{background:#2e1a08; border:1px solid #5c3a12; color:#f5c078;}
.banner.info{background:#0e1f36; border:1px solid #1c3a5c; color:#8fb4e8;}

.table{width:100%; border-collapse:collapse; font-size:12.5px;}
.table th{text-align:left; color:var(--text2); font-weight:500; padding:8px 10px; border-bottom:1px solid var(--border); font-size:11.5px; text-transform:uppercase;}
.table td{padding:9px 10px; border-bottom:1px solid var(--border);}
.table tr:last-child td{border-bottom:none;}

.tabs{display:flex; gap:4px; margin-bottom:16px;}
.tab{padding:7px 14px; border-radius:8px; font-size:12.5px; color:var(--text2); cursor:pointer; border:1px solid transparent;}
.tab.active{background:var(--card2); color:var(--text); border-color:var(--border);}

.fab{
  position:sticky; bottom:0; margin-top:24px; display:flex; justify-content:flex-end;
}
.fab-btn{
  background:var(--accent); color:#fff; border:none; border-radius:100px; padding:13px 22px;
  font-size:13.5px; font-weight:600; cursor:pointer; box-shadow:0 6px 18px rgba(59,130,246,.35);
  display:flex; align-items:center; gap:8px;
}

.pin-wrap{max-width:340px; margin:60px auto; text-align:center;}
.pin-dots{display:flex; gap:14px; justify-content:center; margin:24px 0;}
.pin-dot{width:14px; height:14px; border-radius:50%; border:1.5px solid var(--text3);}
.pin-dot.filled{background:var(--accent); border-color:var(--accent);}
.pin-pad{display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-top:20px;}
.pin-key{background:var(--card); border:1px solid var(--border); border-radius:12px; padding:16px; font-size:18px; cursor:pointer; color:var(--text);}
.pin-key:hover{border-color:var(--accent);}

.steps{display:flex; gap:8px; margin-bottom:26px;}
.step{flex:1; height:4px; border-radius:100px; background:var(--card2);}
.step.done{background:var(--accent);}

.msg{max-width:80%; padding:10px 14px; border-radius:12px; font-size:13px; margin-bottom:10px;}
.msg.bot{background:var(--card2); border:1px solid var(--border);}
.msg.user{background:var(--accent); color:#fff; margin-left:auto;}
