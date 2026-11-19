'use strict';
(async()=>{
 const status=document.getElementById('status'),link=document.getElementById('open');
 try{
  const response=await fetch('./game.json',{cache:'no-store'});
  if(!response.ok)throw Error('config');
  const config=await response.json(),url=new URL(config.origin);
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||url.port)throw Error('origin');
  link.href=url.origin+'/';link.hidden=false;
  status.textContent='Вход, награды и прогресс — в одной версии игры.';
  location.replace(link.href);
 }catch{status.textContent='Адрес игры ещё настраивается. Попробуйте открыть эту страницу позже.';}
})();
