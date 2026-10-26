(function(){
"use strict";
var MESES_CORTO=["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
var CAT_G=["Supermercado","Vivienda","Servicios","Transporte","Salud","Salidas","Ropa","Educación","Suscripciones","Otros"];
var CAT_I=["Sueldo","Freelance","Intereses","Otros ingresos"];
var F0=new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:0});
var F2=new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",minimumFractionDigits:2,maximumFractionDigits:2});
var FC=new Intl.NumberFormat("es-AR",{notation:"compact",maximumFractionDigits:1});
var $=function(s,r){return (r||document).querySelector(s)};
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function pad(n){return n<10?"0"+n:""+n}
function ymd(d){return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())}
function parse(s){var p=s.split("-");return {y:+p[0],m:+p[1],d:+p[2]}}
function idxOf(y,m){return y*12+m-1}
function monthName(idx){return new Intl.DateTimeFormat("es-AR",{month:"long",year:"numeric"}).format(new Date(Math.floor(idx/12),idx%12,1))}
function shortDate(s){var p=parse(s);return p.d+" "+MESES_CORTO[p.m-1]}
function newId(){
  if(window.crypto&&crypto.randomUUID) return crypto.randomUUID();
  var h="0123456789abcdef",s="";
  for(var i=0;i<36;i++){s+=(i===8||i===13||i===18||i===23)?"-":i===14?"4":h[Math.floor(Math.random()*16)]}
  return s;
}
function round2(n){return Math.round(n*100)/100}
function parseAmount(s){
  s=String(s).replace(/[\s$]/g,"");
  if(!s) return NaN;
  if(s.indexOf(",")>-1){s=s.replace(/\./g,"").replace(",",".")}
  else if(/^\d{1,3}(\.\d{3})+$/.test(s)){s=s.replace(/\./g,"")}
  var n=parseFloat(s);
  return isFinite(n)?n:NaN;
}

var now=new Date();
var CFG=window.APP_CONFIG||{};
var S={items:[],map:{},pending:[],idx:idxOf(now.getFullYear(),now.getMonth()+1),tab:"resumen",filter:"all",
  chartTable:false,sheet:null,ready:false,view:"loading",authMode:"signin",recovering:false,user:null,status:"idle",installEvt:null,logoutArmed:false};

/* ---------- cálculo ---------- */
function dueIdx(card,dateStr){
  var p=parse(dateStr),idx=idxOf(p.y,p.m);
  if(!card) return idx;
  if(p.d>card.closing) idx+=1;
  if(card.due<=card.closing) idx+=1;
  return idx;
}
function buildFlows(items){
  var cards={};
  items.forEach(function(c){if(c.kind==="card") cards[c.id]=c});
  var out=[];
  items.forEach(function(t){
    if(t.kind!=="tx") return;
    var card=t.type==="expense"&&t.pay==="card"?cards[t.cardId]:null;
    if(card){
      var n=Math.max(1,(t.cuotas|0)||1),base=dueIdx(card,t.date),per=round2(t.amount/n),acc=0;
      for(var k=0;k<n;k++){
        var amt=k===n-1?round2(t.amount-acc):per;
        acc+=per;
        out.push({idx:base+k,amount:amt,type:"expense",category:t.category,tx:t,card:card,cuota:k+1,cuotas:n});
      }
    } else {
      out.push({idx:dueIdx(null,t.date),amount:t.amount,type:t.type,category:t.category,tx:t,card:null,cuota:1,cuotas:1});
    }
  });
  return out;
}
function sum(arr){return arr.reduce(function(a,b){return a+b.amount},0)}
function monthStats(flows,idx){
  var f=flows.filter(function(x){return x.idx===idx});
  var inc=sum(f.filter(function(x){return x.type==="income"}));
  var cash=sum(f.filter(function(x){return x.type==="expense"&&!x.card}));
  var card=sum(f.filter(function(x){return x.type==="expense"&&x.card}));
  return {flows:f,income:inc,cash:cash,card:card,out:cash+card,balance:inc-cash-card};
}
function money(n){return F0.format(n)}
function signed(f){return (f.type==="income"?"+ ":"− ")+F2.format(f.amount)}

/* ---------- guardado y sincronización ---------- */
var SB=null,syncing=false,again=false,rtTimer=null,channel=null;
function KEY(n){return "libreta."+n+"."+(S.user?S.user.id:"anon")}
function loadCache(){
  try{S.map=JSON.parse(localStorage.getItem(KEY("map"))||"{}")||{}}catch(e){S.map={}}
  try{S.pending=JSON.parse(localStorage.getItem(KEY("pending"))||"[]")||[]}catch(e){S.pending=[]}
}
function saveCache(){
  try{localStorage.setItem(KEY("map"),JSON.stringify(S.map));localStorage.setItem(KEY("pending"),JSON.stringify(S.pending))}
  catch(e){toast("No se pudo guardar en este dispositivo. Revisá el espacio disponible.")}
}
function wipeCache(){try{localStorage.removeItem(KEY("map"));localStorage.removeItem(KEY("pending"))}catch(e){}}
function rebuild(){
  S.items=Object.keys(S.map).map(function(id){return S.map[id]}).filter(function(r){return !r.deleted}).map(function(r){return Object.assign({id:r.id,kind:r.kind},r.data)});
}
function markPending(id){
  if(S.pending.indexOf(id)<0) S.pending.push(id);
  saveCache();rebuild();render();sync();
}
function put(doc){
  var id=doc.id||newId(),data={};
  Object.keys(doc).forEach(function(k){if(k!=="id"&&k!=="kind") data[k]=doc[k]});
  S.map[id]={id:id,kind:doc.kind,data:data,deleted:false,updated_at:new Date().toISOString()};
  markPending(id);
  return Promise.resolve();
}
function del(id){
  var r=S.map[id];
  if(r){r.deleted=true;r.updated_at=new Date().toISOString();markPending(id)}
  return Promise.resolve();
}
var toastTimer;
function toast(msg){var t=$("#toast");t.textContent=msg;clearTimeout(toastTimer);toastTimer=setTimeout(function(){t.textContent=""},3600)}
function failMsg(){return "No se pudo guardar. Probá de nuevo."}
function statusText(){
  var who=S.user&&S.user.email?S.user.email+" · ":"",n=S.pending.length;
  if(S.status==="auth") return "Tu sesión venció. Volvé a ingresar.";
  if(!navigator.onLine||S.status==="offline") return who+"Sin conexión"+(n?" · "+n+" cambio"+(n>1?"s":"")+" por enviar":" · los cambios se enviarán al volver");
  if(S.status==="syncing") return who+"Sincronizando…";
  if(S.status==="error") return who+"No se pudo sincronizar"+(n?" · "+n+" por enviar":"")+". Se reintenta solo.";
  return who+(n?"Guardado en este dispositivo, enviando…":"Sincronizado");
}
function paintStatus(){var el=$("#sync");if(el&&S.view==="app") el.textContent=statusText()}
function isAuthErr(e){return e&&(e.status===401||e.status===403||/jwt/i.test(e.message||""))}
function push(){
  var ids=S.pending.filter(function(id){return S.map[id]});
  if(!ids.length){S.pending=[];return Promise.resolve()}
  var chunks=[];
  for(var i=0;i<ids.length;i+=200) chunks.push(ids.slice(i,i+200));
  return chunks.reduce(function(p,chunk){
    return p.then(function(){
      var rows=chunk.map(function(id){var r=S.map[id];return {id:r.id,user_id:S.user.id,kind:r.kind,data:r.data,deleted:!!r.deleted,updated_at:r.updated_at}});
      return SB.from("items").upsert(rows).then(function(res){
        if(res.error) throw res.error;
        S.pending=S.pending.filter(function(id){
          var k=chunk.indexOf(id);
          return k<0||S.map[id].updated_at!==rows[k].updated_at;
        });
        saveCache();
      });
    });
  },Promise.resolve());
}
function pull(){
  var all=[],from=0,size=1000;
  function page(){
    return SB.from("items").select("id,kind,data,deleted,updated_at").order("id").range(from,from+size-1).then(function(res){
      if(res.error) throw res.error;
      all=all.concat(res.data||[]);
      if((res.data||[]).length===size){from+=size;return page()}
    });
  }
  return page().then(function(){
    var seen={};
    all.forEach(function(r){
      seen[r.id]=1;
      if(S.pending.indexOf(r.id)>-1) return;
      var l=S.map[r.id];
      if(!l||new Date(r.updated_at)>=new Date(l.updated_at)){
        S.map[r.id]={id:r.id,kind:r.kind,data:r.data||{},deleted:!!r.deleted,updated_at:r.updated_at};
      }
    });
    Object.keys(S.map).forEach(function(id){
      if(!seen[id]&&S.pending.indexOf(id)<0) delete S.map[id];
    });
    saveCache();
  });
}
function sync(){
  if(!SB||!S.user) return Promise.resolve();
  if(syncing){again=true;return Promise.resolve()}
  if(!navigator.onLine){S.status="offline";paintStatus();return Promise.resolve()}
  syncing=true;S.status="syncing";paintStatus();
  return push().then(pull).then(function(){S.status="ok"}).catch(function(e){
    S.status=isAuthErr(e)?"auth":"error";
  }).then(function(){
    syncing=false;rebuild();
    if(S.view==="app") render();
    if(again){again=false;return sync()}
  });
}
function subscribeRealtime(){
  if(channel||!SB||!S.user) return;
  try{
    channel=SB.channel("items-"+S.user.id).on("postgres_changes",{event:"*",schema:"public",table:"items"},function(){
      clearTimeout(rtTimer);rtTimer=setTimeout(sync,500);
    }).subscribe();
  }catch(e){channel=null}
}
function unsubscribeRealtime(){
  if(channel&&SB){try{SB.removeChannel(channel)}catch(e){}}
  channel=null;
}

/* ---------- render ---------- */
function render(){
  document.body.classList.toggle("authing",S.view!=="app");
  var app=$("#app");
  if(S.view!=="app"){
    $("#sync").textContent="";
    app.innerHTML=S.view==="loading"?'<p class="note">Cargando…</p>':authView(S.view);
    return;
  }
  $("#monthLabel").textContent=monthName(S.idx);
  var nav=document.querySelectorAll(".tabs button");
  Array.prototype.forEach.call(nav,function(b){b.setAttribute("aria-selected",String(b.getAttribute("data-tab")===S.tab))});
  paintStatus();
  if(!S.ready){app.innerHTML='<p class="note">Cargando tus datos…</p>';return}
  if(!S.items.length&&S.tab!=="tarjetas"){app.innerHTML=welcome();return}
  var flows=buildFlows(S.items);
  app.innerHTML=S.tab==="resumen"?viewResumen(flows):S.tab==="movs"?viewMovs(flows):viewTarjetas(flows);
}
function authView(view){
  if(view==="setup") return '<div class="empty"><h2>Falta conectar la base de datos</h2><p>Abrí el archivo <code>config.js</code> y pegá la URL y la clave pública de tu proyecto de Supabase. Los pasos están en LEEME.md.</p></div>';
  if(view==="recovery") return '<form id="authform" class="authbox" novalidate><h2>Elegí una contraseña nueva</h2>'
    +'<div class="f"><label for="a-pw">Contraseña nueva</label><input id="a-pw" type="password" autocomplete="new-password" minlength="6"></div>'
    +'<p class="err" id="autherr" role="alert"></p><p class="hint" id="authinfo"></p>'
    +'<div class="actions"><button type="submit" class="btn" id="authbtn">Guardar contraseña</button></div></form>';
  var m=S.authMode,title=m==="signup"?"Crear cuenta":m==="reset"?"Recuperar contraseña":"Ingresar";
  var h='<form id="authform" class="authbox" novalidate><h2>'+title+'</h2>'
    +'<p class="hint" style="margin-bottom:16px">'+(m==="reset"?"Te enviamos un enlace para elegir una contraseña nueva.":"Tus datos se sincronizan entre todos tus dispositivos con esta cuenta.")+'</p>'
    +'<div class="f"><label for="a-email">Correo electrónico</label><input id="a-email" type="email" autocomplete="username" inputmode="email" autocapitalize="none"></div>';
  if(m!=="reset") h+='<div class="f"><label for="a-pw">Contraseña</label><input id="a-pw" type="password" minlength="6" autocomplete="'+(m==="signup"?"new-password":"current-password")+'"></div>';
  h+='<p class="err" id="autherr" role="alert"></p><p class="hint" id="authinfo"></p>'
    +'<div class="actions"><button type="submit" class="btn" id="authbtn">'+(m==="signup"?"Crear cuenta":m==="reset"?"Enviar enlace":"Ingresar")+'</button></div>'
    +'<div class="authlinks">';
  if(m!=="signin") h+='<button type="button" class="link" data-act="authmode-signin">Ya tengo cuenta</button>';
  if(m!=="signup") h+='<button type="button" class="link" data-act="authmode-signup">Crear cuenta</button>';
  if(m==="signin") h+='<button type="button" class="link" data-act="authmode-reset">Olvidé mi contraseña</button>';
  return h+'</div></form>';
}
function welcome(){
  return '<div class="empty"><h2>Empecemos por tu primer movimiento</h2>'
   +'<p>Cargá un ingreso o un gasto, y si usás tarjeta, agregá primero la tarjeta con su día de cierre y de vencimiento para que las cuotas caigan en el mes correcto.</p>'
   +'<div class="actions"><button type="button" class="btn" data-act="add">Cargar movimiento</button>'
   +'<button type="button" class="btn ghost" data-act="addcard">Agregar tarjeta</button>'
   +'<button type="button" class="btn ghost" data-act="sample">Ver con datos de ejemplo</button></div></div>';
}
function viewResumen(flows){
  var st=monthStats(flows,S.idx);
  var bal=st.balance;
  var h='<div class="grid"><div>';
  h+='<div class="figures">'
   +'<div class="fig main"><span class="lbl">Saldo de '+esc(monthName(S.idx))+'</span><span class="val '+(bal<0?"neg":"pos")+'">'+(bal<0?"− ":"")+money(Math.abs(bal))+'</span></div>'
   +'<div class="fig"><span class="lbl">Ingresos</span><span class="val">'+money(st.income)+'</span></div>'
   +'<div class="fig"><span class="lbl">Gastos</span><span class="val">'+money(st.out)+'</span><span class="sub">Efectivo y débito '+money(st.cash)+' · Tarjeta '+money(st.card)+'</span></div>'
   +'</div>';
  var cats={};
  st.flows.filter(function(f){return f.type==="expense"}).forEach(function(f){cats[f.category]=(cats[f.category]||0)+f.amount});
  var list=Object.keys(cats).map(function(k){return {n:k,a:cats[k]}}).sort(function(a,b){return b.a-a.a});
  h+='<p class="eyebrow">Gastos por categoría</p>';
  if(!list.length) h+='<p class="note" style="margin-top:0">Todavía no hay gastos en este mes.</p>';
  else{
    var max=list[0].a,tot=st.out;
    list.forEach(function(c){
      h+='<div class="cat"><span class="n">'+esc(c.n)+'</span><span class="a">'+money(c.a)+' <span class="p">'+Math.round(c.a/tot*100)+'%</span></span>'
        +'<span class="bar"><b style="width:'+Math.max(2,c.a/max*100).toFixed(1)+'%"></b></span></div>';
    });
  }
  h+='</div><div><p class="eyebrow">Últimos 6 meses</p>'+chart(flows)
   +'<p class="note">Las compras con tarjeta se cuentan en el mes en que vence el resumen, divididas en cuotas. Así ves cuánta plata sale de verdad cada mes.</p>'
   +'<div class="actions" style="margin-top:14px"><button type="button" class="btn ghost" data-act="export">Exportar a CSV</button>'
   +(S.installEvt?'<button type="button" class="btn ghost" data-act="install">Instalar la app</button>':'')
   +(S.items.some(function(i){return i.sample})?'<button type="button" class="btn ghost" data-act="rmsample">Quitar datos de ejemplo</button>':'')
   +'</div>'
   +(iosHint()?'<p class="note">Para instalarla en iPhone o iPad: tocá Compartir y elegí «Agregar a pantalla de inicio».</p>':'')
   +'</div></div>';
  return h;
}
function iosHint(){return /iphone|ipad|ipod/i.test(navigator.userAgent)&&!window.navigator.standalone&&!(window.matchMedia&&matchMedia("(display-mode: standalone)").matches)}
function niceMax(v){
  if(v<=0) return 1;
  var pow=Math.pow(10,Math.floor(Math.log10(v))),c=[1,1.2,1.6,2,2.4,4,6,8,12];
  for(var i=0;i<c.length;i++) if(v<=c[i]*pow) return c[i]*pow;
  return 12*pow;
}
function chart(flows){
  var rows=[],i,mx=0;
  for(i=5;i>=0;i--){
    var idx=S.idx-i,s=monthStats(flows,idx);
    rows.push({idx:idx,label:MESES_CORTO[idx%12],income:s.income,out:s.out});
    mx=Math.max(mx,s.income,s.out);
  }
  var legend='<p class="legend"><span><i style="background:var(--s1)"></i>Ingresos</span><span><i style="background:var(--s2)"></i>Gastos</span></p>';
  if(mx===0) return legend+'<p class="note" style="margin-top:0">Todavía no hay movimientos en estos meses.</p>';
  var tbl='<table class="t"><thead><tr><th>Mes</th><th>Ingresos</th><th>Gastos</th></tr></thead><tbody>'
    +rows.map(function(r){return '<tr><td>'+esc(monthName(r.idx))+'</td><td>'+money(r.income)+'</td><td>'+money(r.out)+'</td></tr>'}).join("")+'</tbody></table>';
  var toggle='<button type="button" class="link" data-act="charttable">'+(S.chartTable?"Ver gráfico":"Ver como tabla")+'</button>';
  if(S.chartTable) return legend+'<div class="chartbox">'+tbl+'</div>'+toggle;
  var W=640,H=240,L=54,R=8,T=12,B=28,pw=W-L-R,ph=H-T-B,top=niceMax(mx),svg='';
  function y(v){return T+ph-v/top*ph}
  for(i=0;i<=4;i++){
    var v=top/4*i;
    svg+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+y(v).toFixed(1)+'" y2="'+y(v).toFixed(1)+'" stroke="var(--line)" stroke-width="1"/>'
       +'<text x="'+(L-8)+'" y="'+(y(v)+4).toFixed(1)+'" text-anchor="end">'+(v===0?"0":FC.format(v))+'</text>';
  }
  var gw=pw/6,bw=Math.min(24,gw*.3);
  rows.forEach(function(r,k){
    var cx=L+gw*k+gw/2,sel=r.idx===S.idx;
    if(sel) svg+='<rect x="'+(cx-gw/2+4).toFixed(1)+'" y="'+T+'" width="'+(gw-8).toFixed(1)+'" height="'+ph+'" rx="6" fill="var(--wash)"/>';
    var hi=r.income/top*ph,ho=r.out/top*ph;
    svg+='<rect x="'+(cx-bw-1).toFixed(1)+'" y="'+(T+ph-hi).toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+Math.max(hi,0).toFixed(1)+'" rx="3" fill="var(--s1)"><title>'+esc(monthName(r.idx))+' · Ingresos '+money(r.income)+'</title></rect>'
       +'<rect x="'+(cx+1).toFixed(1)+'" y="'+(T+ph-ho).toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+Math.max(ho,0).toFixed(1)+'" rx="3" fill="var(--s2)"><title>'+esc(monthName(r.idx))+' · Gastos '+money(r.out)+'</title></rect>'
       +'<text x="'+cx.toFixed(1)+'" y="'+(H-8)+'" text-anchor="middle"'+(sel?' style="font-weight:700;fill:var(--ink)"':'')+'>'+r.label+'</text>';
  });
  svg+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+(T+ph)+'" y2="'+(T+ph)+'" stroke="var(--muted)" stroke-width="1"/>';
  return legend+'<div class="chartbox"><svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Ingresos y gastos de los últimos 6 meses">'+svg+'</svg></div>'+toggle;
}
function viewMovs(flows){
  var st=monthStats(flows,S.idx);
  var f=st.flows.filter(function(x){return S.filter==="all"||(S.filter==="in"?x.type==="income":x.type==="expense")});
  f.sort(function(a,b){return a.tx.date<b.tx.date?1:a.tx.date>b.tx.date?-1:0});
  var h='<div class="seg" role="group" aria-label="Filtrar movimientos">'
   +[["all","Todos"],["in","Ingresos"],["out","Gastos"]].map(function(o){return '<button type="button" data-filter="'+o[0]+'" aria-pressed="'+(S.filter===o[0])+'">'+o[1]+'</button>'}).join("")+'</div>';
  if(!f.length) return h+'<div class="empty"><p style="margin-top:18px">No hay movimientos para este mes. Tocá Agregar para cargar uno.</p></div>';
  h+='<ul class="rows">';
  f.forEach(function(x){
    var t=x.tx,sub=shortDate(t.date)+" · "+esc(t.category)+(x.card?" · "+esc(x.card.name)+(x.cuotas>1?" · cuota "+x.cuota+"/"+x.cuotas:""):"");
    h+='<li><button type="button" class="row" data-edit="'+esc(t.id)+'"><span class="m">'+esc(t.note||t.category)+(t.sample?' <span class="hint">(ejemplo)</span>':'')+'</span>'
      +'<span class="s">'+sub+'</span><span class="amt '+(x.type==="income"?"pos":"")+'">'+signed(x)+'</span></button></li>';
  });
  return h+'</ul>';
}
function viewTarjetas(flows){
  var cards=S.items.filter(function(c){return c.kind==="card"});
  var h='<div class="actions" style="margin-bottom:20px"><button type="button" class="btn" data-act="addcard">Agregar tarjeta</button></div>';
  if(!cards.length) return h+'<div class="empty"><p>Todavía no cargaste ninguna tarjeta. Con el día de cierre y de vencimiento, cada compra en cuotas se reparte en los resúmenes que le corresponden.</p></div>';
  cards.forEach(function(c){
    var mine=flows.filter(function(f){return f.card&&f.card.id===c.id});
    var cur=mine.filter(function(f){return f.idx===S.idx}).sort(function(a,b){return a.tx.date<b.tx.date?1:-1});
    var fut=sum(mine.filter(function(f){return f.idx>S.idx}));
    h+='<section class="cardblock"><div class="cardhead"><div><h3>'+esc(c.name)+'</h3><p>Cierra el '+c.closing+' · vence el '+c.due+'</p></div>'
      +'<button type="button" class="btn ghost" data-editcard="'+esc(c.id)+'">Editar</button></div>'
      +'<div class="cardtotal">'+money(sum(cur))+'</div><p class="hint">A pagar en '+esc(monthName(S.idx))+(c.sample?' · ejemplo':'')+'</p>';
    if(cur.length){
      h+='<ul class="rows">';
      cur.forEach(function(x){
        h+='<li><button type="button" class="row" data-edit="'+esc(x.tx.id)+'"><span class="m">'+esc(x.tx.note||x.tx.category)+'</span>'
          +'<span class="s">'+shortDate(x.tx.date)+' · '+esc(x.tx.category)+(x.cuotas>1?' · cuota '+x.cuota+'/'+x.cuotas:'')+'</span>'
          +'<span class="amt">'+F2.format(x.amount)+'</span></button></li>';
      });
      h+='</ul>';
    }
    h+='<p class="hint" style="margin-top:12px">Cuotas ya comprometidas para los meses siguientes: <b>'+money(fut)+'</b></p></section>';
  });
  return h;
}

/* ---------- formulario ---------- */
function options(list,sel){return list.map(function(o){return '<option'+(o===sel?' selected':'')+'>'+esc(o)+'</option>'}).join("")}
function openSheet(kind,item){S.sheet={kind:kind,item:item||null,type:item&&item.type?item.type:"expense",confirm:false};drawSheet();$("#sheet").hidden=false;var f=$("#sheet input,#sheet select");if(f) setTimeout(function(){f.focus()},30)}
function closeSheet(){$("#sheet").hidden=true;S.sheet=null;$("#sheet").innerHTML=""}
function drawSheet(){
  var sh=S.sheet,it=sh.item,h;
  if(sh.kind==="card"){
    h='<form class="sheet" id="form" novalidate><h2>'+(it?"Editar tarjeta":"Nueva tarjeta")+'</h2>'
     +'<div class="f"><label for="c-name">Nombre</label><input id="c-name" value="'+esc(it?it.name:"")+'" placeholder="Visa Banco Nación" autocomplete="off"></div>'
     +'<div class="two"><div class="f"><label for="c-close">Día de cierre</label><input id="c-close" type="number" min="1" max="31" inputmode="numeric" value="'+(it?it.closing:"")+'"></div>'
     +'<div class="f"><label for="c-due">Día de vencimiento</label><input id="c-due" type="number" min="1" max="31" inputmode="numeric" value="'+(it?it.due:"")+'"></div></div>'
     +'<p class="hint" style="margin-bottom:14px">Los dos días figuran en tu resumen. Una compra hecha después del cierre entra en el resumen siguiente.</p>'
     +'<p class="err" id="err"></p><div class="actions"><button type="submit" class="btn">Guardar</button><button type="button" class="btn ghost" data-act="close">Cancelar</button>'
     +(it?'<button type="button" class="btn danger" data-act="delcard">'+(sh.confirm?"Confirmar: eliminar tarjeta":"Eliminar")+'</button>':'')+'</div>'
     +(it&&sh.confirm?'<p class="hint" style="margin-top:10px">Las compras de esta tarjeta quedan registradas como gastos del día en que se hicieron.</p>':'')+'</form>';
  } else {
    var cards=S.items.filter(function(c){return c.kind==="card"}),isE=sh.type==="expense";
    var pay=it&&it.pay==="card"?it.cardId:"cash";
    h='<form class="sheet" id="form" novalidate><h2>'+(it?"Editar movimiento":"Nuevo movimiento")+'</h2>'
     +'<div class="f"><span class="l">Tipo</span><div class="seg" role="group" aria-label="Tipo"><button type="button" data-type="expense" aria-pressed="'+isE+'">Gasto</button><button type="button" data-type="income" aria-pressed="'+!isE+'">Ingreso</button></div></div>'
     +'<div class="two"><div class="f"><label for="t-amt">Monto (ARS)</label><input id="t-amt" inputmode="decimal" autocomplete="off" placeholder="0,00" value="'+(it?String(it.amount).replace(".",","):"")+'"></div>'
     +'<div class="f"><label for="t-date">Fecha</label><input id="t-date" type="date" value="'+(it?it.date:ymd(new Date()))+'"></div></div>'
     +'<div class="f"><label for="t-cat">Categoría</label><select id="t-cat">'+options(isE?CAT_G:CAT_I,it&&it.type===sh.type?it.category:null)+'</select></div>'
     +'<div id="payblock" '+(isE?'':'hidden')+'><div class="two"><div class="f"><label for="t-pay">Medio de pago</label><select id="t-pay"><option value="cash">Efectivo o débito</option>'
     +cards.map(function(c){return '<option value="'+esc(c.id)+'"'+(pay===c.id?' selected':'')+'>'+esc(c.name)+'</option>'}).join("")+'</select></div>'
     +'<div class="f" id="cuotasblock" '+(pay==="cash"?'hidden':'')+'><label for="t-cuotas">Cuotas</label><input id="t-cuotas" type="number" min="1" max="60" inputmode="numeric" value="'+(it&&it.cuotas?it.cuotas:1)+'"></div></div>'
     +(cards.length?'':'<p class="hint" style="margin:-6px 0 14px">Para cargar compras con tarjeta, primero agregá la tarjeta en la pestaña Tarjetas.</p>')+'</div>'
     +'<div class="f"><label for="t-note">Detalle (opcional)</label><input id="t-note" autocomplete="off" placeholder="Ej: changuito semanal" value="'+esc(it?it.note||"":"")+'"></div>'
     +'<p class="err" id="err"></p><div class="actions"><button type="submit" class="btn">Guardar</button><button type="button" class="btn ghost" data-act="close">Cancelar</button>'
     +(it?'<button type="button" class="btn danger" data-act="deltx">'+(sh.confirm?"Confirmar: eliminar":"Eliminar")+'</button>':'')+'</div></form>';
  }
  $("#sheet").innerHTML=h;
}
function submitForm(){
  var sh=S.sheet,err=$("#err"),it=sh.item;
  if(sh.kind==="card"){
    var name=$("#c-name").value.trim(),cl=parseInt($("#c-close").value,10),du=parseInt($("#c-due").value,10);
    if(!name){err.textContent="Escribí un nombre para la tarjeta.";return}
    if(!(cl>=1&&cl<=31)||!(du>=1&&du<=31)){err.textContent="El cierre y el vencimiento son días del mes, del 1 al 31.";return}
    var doc=Object.assign({},it||{},{kind:"card",name:name,closing:cl,due:du});
    put(doc).then(function(){closeSheet();toast("Tarjeta guardada")}).catch(function(e){err.textContent=failMsg(e)});
    return;
  }
  var amt=parseAmount($("#t-amt").value),date=$("#t-date").value;
  if(!(amt>0)){err.textContent="Ingresá un monto mayor a cero, por ejemplo 12500 o 12.500,50.";return}
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){err.textContent="Elegí una fecha.";return}
  var isE=sh.type==="expense",d={kind:"tx",type:sh.type,amount:round2(amt),date:date,category:$("#t-cat").value,note:$("#t-note").value.trim()};
  if(it&&it.id) d.id=it.id;
  if(it&&it.sample) d.sample=true;
  if(isE){
    var pay=$("#t-pay").value;
    if(pay==="cash"){d.pay="cash"}
    else{
      var n=parseInt($("#t-cuotas").value,10);
      if(!(n>=1&&n<=60)){err.textContent="Las cuotas van de 1 a 60.";return}
      d.pay="card";d.cardId=pay;d.cuotas=n;
    }
  }
  put(d).then(function(){
    closeSheet();toast("Movimiento guardado");
    var p=parse(date);S.idx=dueIdx(d.pay==="card"?S.items.filter(function(c){return c.id===d.cardId})[0]:null,date);
    render();
  }).catch(function(e){err.textContent=failMsg(e)});
}

/* ---------- ejemplos y exportación ---------- */
function sampleData(){
  var y=now.getFullYear(),m=now.getMonth()+1;
  function dt(day,back){var d=new Date(y,m-1-(back||0),day);return ymd(d)}
  var cid=newId();
  var list=[
    {id:cid,kind:"card",name:"Visa (ejemplo)",closing:20,due:5,sample:true},
    {kind:"tx",type:"income",amount:1350000,date:dt(1),category:"Sueldo",note:"Sueldo del mes",sample:true},
    {kind:"tx",type:"income",amount:180000,date:dt(12),category:"Freelance",note:"Trabajo de diseño",sample:true},
    {kind:"tx",type:"expense",amount:420000,date:dt(3),category:"Vivienda",note:"Alquiler",pay:"cash",sample:true},
    {kind:"tx",type:"expense",amount:86400,date:dt(7),category:"Supermercado",note:"Compra grande",pay:"cash",sample:true},
    {kind:"tx",type:"expense",amount:38900,date:dt(9),category:"Servicios",note:"Luz y gas",pay:"cash",sample:true},
    {kind:"tx",type:"expense",amount:24000,date:dt(10),category:"Transporte",note:"Carga de SUBE",pay:"cash",sample:true},
    {kind:"tx",type:"expense",amount:900000,date:dt(8,2),category:"Otros",note:"Notebook en 6 cuotas",pay:"card",cardId:cid,cuotas:6,sample:true},
    {kind:"tx",type:"expense",amount:42500,date:dt(14),category:"Salidas",note:"Cena con amigos",pay:"card",cardId:cid,cuotas:1,sample:true},
    {kind:"tx",type:"expense",amount:15800,date:dt(5),category:"Suscripciones",note:"Streaming y música",pay:"card",cardId:cid,cuotas:1,sample:true}
  ];
  return list;
}
function loadSample(){
  var list=sampleData(),p=Promise.resolve();
  list.forEach(function(d){p=p.then(function(){return put(d)})});
  p.then(function(){toast("Datos de ejemplo cargados")}).catch(function(e){toast(failMsg(e))});
}
function removeSample(){
  var ids=S.items.filter(function(i){return i.sample}).map(function(i){return i.id}),p=Promise.resolve();
  ids.forEach(function(id){p=p.then(function(){return del(id)})});
  p.then(function(){toast("Ejemplos eliminados")}).catch(function(e){toast(failMsg(e))});
}
function csvCell(v){v=String(v==null?"":v);return /[;"\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}
function exportCsv(){
  var cards={};
  S.items.forEach(function(c){if(c.kind==="card") cards[c.id]=c.name});
  var rows=S.items.filter(function(t){return t.kind==="tx"}).sort(function(a,b){return a.date<b.date?-1:1});
  var lines=[["fecha","tipo","categoria","detalle","medio","tarjeta","cuotas","monto"].join(";")];
  rows.forEach(function(t){
    lines.push([t.date,t.type==="income"?"ingreso":"gasto",t.category,t.note||"",t.pay==="card"?"tarjeta":(t.type==="income"?"":"efectivo/debito"),
      t.pay==="card"?(cards[t.cardId]||""):"",t.pay==="card"?t.cuotas:"",String(t.amount).replace(".",",")].map(csvCell).join(";"));
  });
  try{
    var blob=new Blob(["﻿"+lines.join("\r\n")],{type:"text/csv;charset=utf-8"});
    var url=URL.createObjectURL(blob),el=document.createElement("a");
    el.href=url;el.download="libreta-de-gastos.csv";document.body.appendChild(el);el.click();
    setTimeout(function(){document.body.removeChild(el);URL.revokeObjectURL(url)},1000);
    toast("Archivo generado");
  }catch(e){toast("No se pudo exportar el archivo.")}
}

/* ---------- eventos ---------- */
document.addEventListener("click",function(ev){
  var t=ev.target.closest("[data-act],[data-tab],[data-filter],[data-edit],[data-editcard],[data-type]");
  if(!t) return;
  var a=t.getAttribute("data-act");
  if(t.hasAttribute("data-tab")){S.tab=t.getAttribute("data-tab");render();return}
  if(t.hasAttribute("data-filter")){S.filter=t.getAttribute("data-filter");render();return}
  if(t.hasAttribute("data-edit")){var tx=S.items.filter(function(i){return i.id===t.getAttribute("data-edit")})[0];if(tx) openSheet("tx",tx);return}
  if(t.hasAttribute("data-editcard")){var cd=S.items.filter(function(i){return i.id===t.getAttribute("data-editcard")})[0];if(cd) openSheet("card",cd);return}
  if(t.hasAttribute("data-type")){
    var ty=t.getAttribute("data-type");
    if(S.sheet&&S.sheet.type!==ty){
      var keep={amt:$("#t-amt").value,date:$("#t-date").value,note:$("#t-note").value};
      S.sheet.type=ty;
      drawSheet();$("#t-amt").value=keep.amt;$("#t-date").value=keep.date;$("#t-note").value=keep.note;
    }
    return;
  }
  if(a==="prev"){S.idx--;render()}
  else if(a==="next"){S.idx++;render()}
  else if(a==="add") openSheet("tx",null);
  else if(a==="addcard") openSheet("card",null);
  else if(a==="close") closeSheet();
  else if(a==="sample") loadSample();
  else if(a==="rmsample") removeSample();
  else if(a==="export") exportCsv();
  else if(a==="install"&&S.installEvt){var ev2=S.installEvt;S.installEvt=null;ev2.prompt();render()}
  else if(a==="logout") logout();
  else if(a&&a.indexOf("authmode-")===0){S.authMode=a.slice(9);render();var em=$("#a-email");if(em) em.focus()}
  else if(a==="charttable"){S.chartTable=!S.chartTable;render()}
  else if(a==="deltx"||a==="delcard"){
    if(!S.sheet.confirm){S.sheet.confirm=true;drawSheetKeep();return}
    var id=S.sheet.item.id;
    del(id).then(function(){closeSheet();toast("Eliminado")}).catch(function(e){var er=$("#err");if(er) er.textContent=failMsg(e)});
  }
});
function drawSheetKeep(){
  var vals={};
  Array.prototype.forEach.call(document.querySelectorAll("#sheet input,#sheet select"),function(el){vals[el.id]=el.value});
  drawSheet();
  Object.keys(vals).forEach(function(id){var el=document.getElementById(id);if(el) el.value=vals[id]});
}
document.addEventListener("change",function(ev){
  if(ev.target.id==="t-pay"){$("#cuotasblock").hidden=ev.target.value==="cash"}
});
document.addEventListener("submit",function(ev){
  ev.preventDefault();
  if(ev.target.id==="authform") submitAuth();
  else if(S.sheet) submitForm();
});
window.addEventListener("beforeinstallprompt",function(ev){ev.preventDefault();S.installEvt=ev;if(S.view==="app") render()});
window.addEventListener("appinstalled",function(){S.installEvt=null;if(S.view==="app") render()});
window.addEventListener("online",function(){S.status="idle";sync()});
window.addEventListener("offline",function(){S.status="offline";paintStatus()});
document.addEventListener("visibilitychange",function(){if(!document.hidden) sync()});
document.addEventListener("keydown",function(ev){if(ev.key==="Escape"&&S.sheet) closeSheet()});
$("#sheet").addEventListener("mousedown",function(ev){if(ev.target===ev.currentTarget) closeSheet()});

/* ---------- cuenta ---------- */
function authMsg(e){
  var m=(e&&e.message)||"";
  if(/invalid login credentials/i.test(m)) return "Correo o contraseña incorrectos.";
  if(/email not confirmed/i.test(m)) return "Todavía no confirmaste tu correo. Revisá tu bandeja de entrada.";
  if(/already registered|already been registered/i.test(m)) return "Ese correo ya tiene una cuenta. Probá ingresar.";
  if(/at least|weak/i.test(m)) return "La contraseña es muy corta o débil. Usá al menos 6 caracteres.";
  if(/rate limit|too many|seconds/i.test(m)) return "Hiciste demasiados intentos. Esperá unos minutos y probá de nuevo.";
  if(/failed to fetch|network|load failed/i.test(m)) return "No hay conexión con el servidor. Revisá tu internet.";
  return "No se pudo completar la operación ("+m+").";
}
function submitAuth(){
  var err=$("#autherr"),info=$("#authinfo"),btn=$("#authbtn");
  err.textContent="";info.textContent="";
  var pwEl=$("#a-pw"),pw=pwEl?pwEl.value:"";
  if(S.view==="recovery"){
    if(pw.length<6){err.textContent="La contraseña debe tener al menos 6 caracteres.";return}
    btn.disabled=true;
    SB.auth.updateUser({password:pw}).then(function(res){
      btn.disabled=false;
      if(res.error){err.textContent=authMsg(res.error);return}
      S.recovering=false;S.view="app";render();toast("Contraseña actualizada");
    });
    return;
  }
  var mode=S.authMode,email=$("#a-email").value.trim();
  if(!/^\S+@\S+\.\S+$/.test(email)){err.textContent="Escribí un correo válido.";return}
  if(mode!=="reset"&&pw.length<6){err.textContent="La contraseña debe tener al menos 6 caracteres.";return}
  var back=location.origin+location.pathname,p;
  btn.disabled=true;
  if(mode==="signin") p=SB.auth.signInWithPassword({email:email,password:pw});
  else if(mode==="signup") p=SB.auth.signUp({email:email,password:pw,options:{emailRedirectTo:back}});
  else p=SB.auth.resetPasswordForEmail(email,{redirectTo:back});
  p.then(function(res){
    btn.disabled=false;
    if(res.error){err.textContent=authMsg(res.error);return}
    if(mode==="signup"&&!(res.data&&res.data.session)) info.textContent="Si el correo es nuevo, te enviamos un mensaje para confirmarlo. Después volvé acá e ingresá. Si ya tenías cuenta, ingresá con tu contraseña.";
    else if(mode==="reset") info.textContent="Si el correo tiene una cuenta, te enviamos un enlace para elegir una contraseña nueva.";
  }).catch(function(e){btn.disabled=false;err.textContent=authMsg(e)});
}
function logout(){
  if(S.pending.length&&!S.logoutArmed){
    S.logoutArmed=true;setTimeout(function(){S.logoutArmed=false},6000);
    toast("Hay cambios sin enviar. Tocá «Cerrar sesión» de nuevo para salir igual y descartarlos.");
    return;
  }
  S.logoutArmed=false;
  unsubscribeRealtime();
  wipeCache();
  SB.auth.signOut();
}
function onSession(session,event){
  if(event==="PASSWORD_RECOVERY") S.recovering=true;
  if(session&&session.user){
    var same=S.user&&S.user.id===session.user.id;
    S.user=session.user;
    if(!same){loadCache();rebuild();S.status="idle"}
    S.ready=true;
    S.view=S.recovering?"recovery":"app";
    render();
    if(S.view==="app"){sync();subscribeRealtime()}
  } else {
    unsubscribeRealtime();
    S.user=null;S.map={};S.pending=[];S.items=[];S.ready=false;S.view="auth";
    render();
  }
}

/* ---------- arranque ---------- */
render();
if("serviceWorker" in navigator){
  window.addEventListener("load",function(){navigator.serviceWorker.register("sw.js").catch(function(){})});
}
(function boot(){
  if(!CFG.SUPABASE_URL||!CFG.SUPABASE_KEY||!window.supabase){S.view="setup";render();return}
  SB=window.supabase.createClient(CFG.SUPABASE_URL,CFG.SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  SB.auth.onAuthStateChange(function(event,session){
    if(event==="TOKEN_REFRESHED"||event==="USER_UPDATED") return;
    setTimeout(function(){onSession(session,event)},0);
  });
  SB.auth.getSession().then(function(r){
    if(S.view==="loading") onSession(r.data&&r.data.session,"INITIAL");
  }).catch(function(){if(S.view==="loading"){S.view="auth";render()}});
})();
})();
