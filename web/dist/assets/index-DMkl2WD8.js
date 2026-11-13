var We=Object.defineProperty;var $e=(d,i,s)=>i in d?We(d,i,{enumerable:!0,configurable:!0,writable:!0,value:s}):d[i]=s;var m=(d,i,s)=>$e(d,typeof i!="symbol"?i+"":i,s);function Ne(d,i){for(var s=0;s<i.length;s++){const h=i[s];if(typeof h!="string"&&!Array.isArray(h)){for(const a in h)if(a!=="default"&&!(a in d)){const t=Object.getOwnPropertyDescriptor(h,a);t&&Object.defineProperty(d,a,t.get?t:{enumerable:!0,get:()=>h[a]})}}}return Object.freeze(Object.defineProperty(d,Symbol.toStringTag,{value:"Module"}))}var Y={},W={},ee;function Se(){if(ee)return W;ee=1,Object.defineProperty(W,"__esModule",{value:!0}),W.LocalStorage=void 0;class d{async get(s){return typeof window>"u"?null:localStorage.getItem(s)}async set(s,h){typeof window>"u"||localStorage.setItem(s,h)}async remove(s){typeof window>"u"||localStorage.removeItem(s)}}return W.LocalStorage=d,W}var $={},N={},B={},te;function je(){if(te)return B;te=1,Object.defineProperty(B,"__esModule",{value:!0}),B.encodeBase58=i;const d="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";function i(s){if(s.length===0)return"";let h=0,a=0;for(;a<s.length&&s[a]===0;)h++,a++;let t=[0];for(;a<s.length;a++){let n=s[a];for(let l=0;l<t.length;++l)n+=t[l]<<8,t[l]=n%58,n=n/58|0;for(;n>0;)t.push(n%58),n=n/58|0}for(;t.length>0&&t[t.length-1]===0;)t.pop();let e="";for(let n=0;n<h;n++)e+=d[0];for(let n=t.length-1;n>=0;--n)e+=d[t[n]];return e}return B}var ne;function J(){if(ne)return N;ne=1,Object.defineProperty(N,"__esModule",{value:!0}),N.nearActionsToConnectorActions=void 0;const d=je(),i=t=>{try{return JSON.parse(new TextDecoder().decode(t))}catch{return t}},s=t=>t.enum!=null?t.enum==="fullAccess":"fullAccess"in t,h=t=>t.enum!=null?t.enum==="AccountId":"AccountId"in t,a=t=>t.map(e=>{var n;if("type"in e)return e;if(e.signedDelegate)throw new Error("SignedDelegate actions cannot be sent through the wallet connector; wallets sign delegates via signDelegateActions");if(e.functionCall)return{type:"FunctionCall",params:{methodName:e.functionCall.methodName,args:i(e.functionCall.args),gas:e.functionCall.gas.toString(),deposit:e.functionCall.deposit.toString()}};if(e.deployGlobalContract)return{type:"DeployGlobalContract",params:{code:e.deployGlobalContract.code,deployMode:h(e.deployGlobalContract.deployMode)?"AccountId":"CodeHash"}};if(e.createAccount)return{type:"CreateAccount"};if(e.useGlobalContract){const l=e.useGlobalContract.contractIdentifier;return{type:"UseGlobalContract",params:{contractIdentifier:l.AccountId!=null?{accountId:l.AccountId}:{codeHash:(0,d.encodeBase58)(l.CodeHash)}}}}if(e.deployContract)return{type:"DeployContract",params:{code:e.deployContract.code}};if(e.deleteAccount)return{type:"DeleteAccount",params:{beneficiaryId:e.deleteAccount.beneficiaryId}};if(e.deleteKey)return{type:"DeleteKey",params:{publicKey:e.deleteKey.publicKey.toString()}};if(e.transfer)return{type:"Transfer",params:{deposit:e.transfer.deposit.toString()}};if(e.stake)return{type:"Stake",params:{stake:e.stake.stake.toString(),publicKey:e.stake.publicKey.toString()}};if(e.addKey){const{permission:l}=e.addKey.accessKey;let u;if(l.functionCall)u={receiverId:l.functionCall.receiverId,allowance:(n=l.functionCall.allowance)==null?void 0:n.toString(),methodNames:l.functionCall.methodNames};else if(s(l))u="FullAccess";else throw new Error("Unsupported access-key permission on AddKey: only functionCall and fullAccess can be sent through the wallet connector (pass a ConnectorAction otherwise)");return{type:"AddKey",params:{publicKey:e.addKey.publicKey.toString(),accessKey:{nonce:Number(e.addKey.accessKey.nonce),permission:u}}}}throw new Error("Unsupported action type")});return N.nearActionsToConnectorActions=a,N}var X={},re;function V(){return re||(re=1,(function(d){Object.defineProperty(d,"__esModule",{value:!0}),d.isGasKeyAction=void 0,d.assertGasKeyActionsSupported=s;const i=h=>h.type==="TransferToGasKey"||h.type==="WithdrawFromGasKey"||h.type==="AddKey"&&h.params.gasKeyInfo!=null;d.isGasKeyAction=i;function s(h,a,t){if(h!=null&&h.gasKeys)return;const e=a.filter(d.isGasKeyAction).map(n=>n.type);if(e.length!==0)throw new Error(`${t} does not advertise gas-key support (manifest features.gasKeys), so ${[...new Set(e)].join(", ")} cannot be sent through it; a wallet that does not know gasKeyInfo could add a plain key instead. Sign locally with a full-access key, or use a wallet whose manifest sets features.gasKeys.`)}})(X)),X}var j={},oe;function Z(){if(oe)return j;oe=1,Object.defineProperty(j,"__esModule",{value:!0}),j.uuid4=void 0;const d=()=>typeof window<"u"&&typeof window.crypto<"u"&&typeof window.crypto.randomUUID=="function"?window.crypto.randomUUID():"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(i){const s=Math.random()*16|0;return(i==="x"?s:s&3|8).toString(16)});return j.uuid4=d,j}var se;function Ce(){if(se)return $;se=1,Object.defineProperty($,"__esModule",{value:!0}),$.ParentFrameWallet=void 0;const d=J(),i=V(),s=Z();let h=class{constructor(t,e){m(this,"connector");m(this,"manifest");this.connector=t,this.manifest=e}callParentFrame(t,e){const n=(0,s.uuid4)();return window.parent.postMessage({type:"near-wallet-injected-request",id:n,method:t,params:e},"*"),new Promise((l,u)=>{const c=g=>{g.data.type==="near-wallet-injected-response"&&g.data.id===n&&(window.removeEventListener("message",c),g.data.success?l(g.data.result):u(g.data.error))};window.addEventListener("message",c)})}async signIn(t){const e=await this.callParentFrame("near:signIn",{network:(t==null?void 0:t.network)??this.connector.network,addFunctionCallKey:t==null?void 0:t.addFunctionCallKey});return Array.isArray(e)?e:[e]}async signInAndSignMessage(t){const e=await this.callParentFrame("near:signInAndSignMessage",{network:(t==null?void 0:t.network)??this.connector.network,addFunctionCallKey:t==null?void 0:t.addFunctionCallKey,messageParams:t.messageParams});return Array.isArray(e)?e:[e]}async signOut(t){const e={...t,network:(t==null?void 0:t.network)??this.connector.network};await this.callParentFrame("near:signOut",e)}async getAccounts(t){const e={...t,network:(t==null?void 0:t.network)??this.connector.network};return this.callParentFrame("near:getAccounts",e)}async signAndSendTransaction(t){const e=(0,d.nearActionsToConnectorActions)(t.actions);(0,i.assertGasKeyActionsSupported)(this.manifest.features,e,this.manifest.name);const n={...t,actions:e,network:t.network??this.connector.network};return this.callParentFrame("near:signAndSendTransaction",n)}async signAndSendTransactions(t){const e=t.transactions.map(l=>({actions:(0,d.nearActionsToConnectorActions)(l.actions),receiverId:l.receiverId}));(0,i.assertGasKeyActionsSupported)(this.manifest.features,e.flatMap(l=>l.actions),this.manifest.name);const n={...t,transactions:e,network:t.network??this.connector.network};return this.callParentFrame("near:signAndSendTransactions",n)}async signMessage(t){const e={...t,network:t.network??this.connector.network};return this.callParentFrame("near:signMessage",e)}async signDelegateActions(t){const e={...t,delegateActions:t.delegateActions.map(n=>({...n,actions:(0,d.nearActionsToConnectorActions)(n.actions)})),network:t.network||this.connector.network};return(0,i.assertGasKeyActionsSupported)(this.manifest.features,e.delegateActions.flatMap(n=>n.actions),this.manifest.name),this.callParentFrame("near:signDelegateActions",e)}};return $.ParentFrameWallet=h,$}var P={},I={},O={},ae;function Pe(){if(ae)return O;ae=1,Object.defineProperty(O,"__esModule",{value:!0}),O.parseUrl=void 0;const d=i=>{try{return new URL(i)}catch{return null}};return O.parseUrl=d,O}var T={},ie;function Oe(){if(ie)return T;ie=1,Object.defineProperty(T,"__esModule",{value:!0}),T.copyText=void 0;const d=async i=>{try{await navigator.clipboard.writeText(i);return}catch{}const s=document.createElement("textarea");s.value=i,s.setAttribute("readonly",""),s.style.position="fixed",s.style.opacity="0",document.body.appendChild(s),s.select();try{if(!document.execCommand("copy"))throw new Error("Copy failed")}finally{s.remove()}};return T.copyText=d,T}var C={},le;function Te(){if(le)return C;le=1,Object.defineProperty(C,"__esModule",{value:!0}),C.openExternalLink=C.openTelegramLink=C.isTelegramMiniApp=void 0;const d=()=>{var n;const e=(n=window==null?void 0:window.Telegram)==null?void 0:n.WebApp;return!e||!e.platform||e.platform==="unknown"?null:e},i=()=>{try{return location.hash.includes("tgWebAppData")?!0:!!sessionStorage.getItem("__telegram__initParams")}catch{return!1}},s=()=>typeof window>"u"?!1:!!d()||!!window.TelegramWebviewProxy||i();C.isTelegramMiniApp=s;const h=(e,n)=>{const l=window.TelegramWebviewProxy;if(l!=null&&l.postEvent)return l.postEvent(e,JSON.stringify(n));const u=window.external;if(u&&"notify"in u)return u.notify(JSON.stringify({eventType:e,eventData:n}));window.parent!==window&&window.parent.postMessage(JSON.stringify({eventType:e,eventData:n}),"https://web.telegram.org")},a=e=>{const n=d();if(n)return n.openTelegramLink(e.toString());h("web_app_open_tg_link",{path_full:e.pathname+e.search})};C.openTelegramLink=a;const t=e=>{const n=d();if(n)return n.openLink(e.toString());h("web_app_open_link",{url:e.toString()})};return C.openExternalLink=t,C}var E={},q={},ce;function _e(){if(ce)return q;ce=1,Object.defineProperty(q,"__esModule",{value:!0}),q.EventEmitter=void 0;class d{constructor(){m(this,"events",{})}on(s,h){this.events[s]||(this.events[s]=[]),this.events[s].push(h)}emit(s,h){var a;(a=this.events[s])==null||a.forEach(t=>t(h))}off(s,h){var a;this.events[s]=(a=this.events[s])==null?void 0:a.filter(t=>t!==h)}once(s,h){const a=t=>{h(t),this.off(s,a)};this.on(s,a)}removeAllListeners(s){s?delete this.events[s]:this.events={}}}return q.EventEmitter=d,q}var K={},L={},de;function Q(){if(de)return L;de=1,Object.defineProperty(L,"__esModule",{value:!0}),L.escapeHtml=d,L.html=s;function d(h){return h.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}const i=Symbol("htmlTag");function s(h,...a){let t=h[0];for(let e=0;e<a.length;e++){for(const n of Array.isArray(a[e])?a[e]:[a[e]]){const l=n!=null&&n[i]?n[i]:d(String(n??""));t+=l}t+=h[e+1]}return Object.freeze({[i]:t,get html(){return t}})}return L}var D={},F={},ue;function qe(){if(ue)return F;ue=1,Object.defineProperty(F,"__esModule",{value:!0}),F.css=void 0;const d=i=>`
${i} * {
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
  -ms-overflow-style: none; 
  scrollbar-width: none; 
  color: #fff;
}

${i} *::-webkit-scrollbar { 
  display: none;
}

${i} p,
${i} h1,
${i} h2,
${i} h3,
${i} h4,
${i} h5,
${i} h6 {
  margin: 0;
}

${i} .modal-container {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 100000000;
    background-color: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    flex-direction: column;
    transition: opacity 0.2s ease-in-out;
}

@media (max-width: 600px) {
  ${i} .modal-container {
    justify-content: flex-end;
  }
}

${i} .modal-content {
  display: flex;
  flex-direction: column;
  align-items: center;

  max-width: 420px;
  max-height: 615px;
  width: 100%;
  border-radius: 24px;
  background: #0d0d0d;
  border: 1.5px solid rgba(255, 255, 255, 0.1);
  transition: transform 0.2s ease-in-out;
}

@media (max-width: 600px) {
  ${i} .modal-content {
    max-width: 100%;
    width: 100%;
    max-height: 80%;
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
    border: none;
    border-top: 1.5px solid rgba(255, 255, 255, 0.1);
  }
}


${i} .modal-header {
  display: flex;
  padding: 16px;
  gap: 16px;
  align-self: stretch;
  align-items: center;
  justify-content: center;
  position: relative;
}

${i} .modal-header button {
  position: absolute;
  right: 16px;
  top: 16px;
  width: 32px;
  height: 32px;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.2s ease-in-out;
  border: none;
  background: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

${i} .modal-header button:hover {
  background: rgba(255, 255, 255, 0.04);
}
  
${i} .modal-header p {
  color: #fff;
  text-align: center;
  font-size: 24px;
  font-style: normal;
  font-weight: 600;
  line-height: normal;
  margin: 0;
}


${i} .modal-body {
  display: flex;
  padding: 16px;
  flex-direction: column;
  align-items: flex-start;
  text-align: center;
  gap: 8px;
  overflow: auto;

  border-radius: 24px;
  background: rgba(255, 255, 255, 0.08);
  width: 100%;
  flex: 1;
}

${i} .modal-body textarea {
  width: 100%;
  padding: 12px;
  border-radius: 12px;
  background: #0d0d0d;
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.1);
  outline: none;
  font-size: 16px;
  transition: background 0.2s ease-in-out;
  font-family: monospace;
  font-size: 12px;
}

${i} .modal-body button {
  width: 100%;
  padding: 12px;
  border-radius: 12px;
  background: #fff;
  color: #000;
  border: none;
  cursor: pointer;
  font-size: 16px;
  transition: background 0.2s ease-in-out;
  margin-top: 16px;
}

${i} .footer {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 16px 24px;
  color: #fff;
  gap: 12px;
}

${i} .modal-body p {
  color: rgba(255, 255, 255, 0.9);
  text-align: center;
  font-size: 16px;
  font-style: normal;
  font-weight: 500;
  line-height: normal;
  letter-spacing: -0.8px;
}

${i} .footer img {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
}

${i} .get-wallet-link {
  color: rgba(255, 255, 255, 0.5);
  text-align: center;
  font-size: 16px;
  font-style: normal;
  font-weight: 500;
  margin-left: auto;
  text-decoration: none;
  transition: color 0.2s ease-in-out;
  cursor: pointer;
}
  
${i} .get-wallet-link:hover {
  color: rgba(255, 255, 255, 1);
}


${i} .connect-item {
  display: flex;
  padding: 8px;
  align-items: center;
  gap: 12px;
  align-self: stretch;
  cursor: pointer;

  transition: background 0.2s ease-in-out;
  border-radius: 24px;
}

${i} .connect-item img {
  width: 48px;
  height: 48px;
  border-radius: 16px;
  object-fit: cover;
  flex-shrink: 0;
}

${i} .connect-item-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  text-align: left;
  flex: 1;
  margin-top: -2px;
}

${i} .connect-item-info .wallet-address {
  color: rgba(255, 255, 255, 0.5);
  font-size: 14px;
  font-style: normal;
  font-weight: 400;
  line-height: normal;
}

${i} .connect-item:hover {
  background: rgba(255, 255, 255, 0.04);
}

${i} .connect-item img {
  width: 48px;
  height: 48px;
  border-radius: 16px;
  object-fit: cover;
}

${i} .connect-item p {
  color: rgba(255, 255, 255, 0.9);
  text-align: center;
  font-size: 18px;
  font-style: normal;
  font-weight: 600;
  line-height: normal;
  letter-spacing: -0.36px;
  margin: 0;
}
`;return F.css=d,F}var he;function Ie(){if(he)return D;he=1,Object.defineProperty(D,"__esModule",{value:!0}),D.Popup=void 0;const d=qe(),i=Q(),s=`n${Math.random().toString(36).substring(2,15)}`;if(typeof document<"u"){const a=document.createElement("style");a.textContent=(0,d.css)(`.${s}`),document.head.append(a)}let h=class{constructor(t){m(this,"delegate");m(this,"isClosed",!1);m(this,"root",document.createElement("div"));m(this,"state",{});m(this,"disposables",[]);this.delegate=t}get dom(){return(0,i.html)``}addListener(t,e,n){const l=typeof t=="string"?this.root.querySelector(t):t;l&&(l.addEventListener(e,n),this.disposables.push(()=>l.removeEventListener(e,n)))}handlers(){this.disposables.forEach(l=>l()),this.disposables=[];const t=this.root.querySelector(".modal-container"),e=this.root.querySelector(".modal-content");e.onclick=l=>l.stopPropagation(),t.onclick=()=>{this.delegate.onReject(),this.destroy()};const n=l=>{l.key==="Escape"&&(this.delegate.onReject(),this.destroy())};document.addEventListener("keydown",n),this.disposables.push(()=>document.removeEventListener("keydown",n))}update(t){this.state={...this.state,...t},this.root.innerHTML=this.dom.html,this.handlers()}create({show:t=!0}){this.root.className=`${s} hot-connector-popup`,this.root.style.display="none",this.root.innerHTML=this.dom.html,document.body.append(this.root),this.handlers();const e=this.root.querySelector(".modal-container"),n=this.root.querySelector(".modal-content");n.style.transform="translateY(50px)",e.style.opacity="0",t&&setTimeout(()=>this.show(),10)}show(){const t=this.root.querySelector(".modal-container"),e=this.root.querySelector(".modal-content");e.style.transform="translateY(50px)",t.style.opacity="0",this.root.style.display="block",setTimeout(()=>{e.style.transform="translateY(0)",t.style.opacity="1"},100)}hide(){const t=this.root.querySelector(".modal-container"),e=this.root.querySelector(".modal-content");e.style.transform="translateY(50px)",t.style.opacity="0",setTimeout(()=>{this.root.style.display="none"},200)}destroy(){this.isClosed||(this.isClosed=!0,this.disposables.forEach(t=>t()),this.disposables=[],this.hide(),setTimeout(()=>{this.root.remove()},200))}};return D.Popup=h,D}var fe;function Ke(){if(fe)return K;fe=1,Object.defineProperty(K,"__esModule",{value:!0}),K.IframeWalletPopup=void 0;const d=Q(),i=Ie();let s=class extends i.Popup{constructor(t){super(t);m(this,"delegate");this.delegate=t}handlers(){super.handlers(),this.addListener("button","click",()=>this.delegate.onApprove())}create(){super.create({show:!1}),this.root.querySelector(".modal-body").appendChild(this.delegate.iframe),this.delegate.iframe.style.width="100%",this.delegate.iframe.style.height="720px",this.delegate.iframe.style.border="none"}get footer(){if(!this.delegate.footer)return"";const{icon:t,heading:e}=this.delegate.footer;return(0,d.html)`
      <div class="footer">
        ${t?(0,d.html)`<img src="${t}" alt="${e}" />`:""}
        <p>${e}</p>
      </div>
    `}get dom(){return(0,d.html)`<div class="modal-container">
      <div class="modal-content">
        <div class="modal-body" style="padding: 0; overflow: auto;"></div>
        ${this.footer}
      </div>
    </div>`}};return K.IframeWalletPopup=s,K}var z={},R={},ge;function Le(){return ge||(ge=1,Object.defineProperty(R,"__esModule",{value:!0}),R.NEAR_CONNECT_VERSION=void 0,R.NEAR_CONNECT_VERSION="0.12.0"),R}var we;function De(){if(we)return z;we=1,Object.defineProperty(z,"__esModule",{value:!0});const d=Le();async function i(s){const h=await s.executor.getAllStorage(),a=s.executor.connector.providers,t=s.executor.manifest,e=s.id,n=s.code.replaceAll(".localStorage",".sandboxedLocalStorage").replaceAll("window.top","window.selector").replaceAll("window.open","window.selector.open"),l=s.cspNonce?` nonce="${s.cspNonce.replace(/[^A-Za-z0-9+/=]/g,"")}"`:"";return`
  <!DOCTYPE html>
  <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body>
      <div id="root"></div>

      <style>
        :root {
          --background-color: rgb(40, 40, 40);
          --text-color: rgb(255, 255, 255);
          --border-color: rgb(209, 209, 209);
        }

        * {
          font-family: system-ui, Avenir, Helvetica, Arial, sans-serif
        }

        body, html {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
          background-color: var(--background-color);
          color: var(--text-color);
        }

        #root {
          display: none;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          width: 100vw;
          background: radial-gradient(circle at center, #2c2c2c 0%, #1a1a1a 100%);
          text-align: center;
        }

        #root * {
          box-sizing: border-box;
          font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
          line-height: 1.5;
          color-scheme: light dark;
          color: rgb(255, 255, 255);
          font-synthesis: none;
          text-rendering: optimizeLegibility;
          -webkit-font-smoothing: antialiased;
        }

        .prompt-container img {
          width: 100px;
          height: 100px;
          object-fit: cover;
          border-radius: 12px;
        }

        .prompt-container h1 {
          margin: 0;
          font-size: 24px;
          font-weight: 600;
          margin-top: 16px;
        }

        .prompt-container p {
          margin: 0;
          font-size: 16px;
          font-weight: 500;
          color: rgb(209, 209, 209);
        }

        .prompt-container button {
          background-color: #131313;
          border: none;
          border-radius: 12px;
          padding: 12px 24px;
          cursor: pointer;
          transition: border-color 0.25s;
          color: #fff;
          outline: none;
          font-size: 14px;
          font-weight: 500;
          font-family: inherit;
          margin-top: 16px;
        }
      </style>


      <script${l}>
      window.sandboxedLocalStorage = (() => {
        let storage = ${JSON.stringify(h)}

        return {
          setItem: function(key, value) {
            window.selector.storage.set(key, value)
            storage[key] = value || '';
          },
          getItem: function(key) {
            return key in storage ? storage[key] : null;
          },
          removeItem: function(key) {
            window.selector.storage.remove(key)
            delete storage[key];
          },
          get length() {
            return Object.keys(storage).length;
          },
          key: function(i) {
            const keys = Object.keys(storage);
            return keys[i] || null;
          },
        };
      })();

      const showPrompt = async (args) => {
        const root = document.getElementById("root");   
        root.style.display = "flex";
        root.innerHTML = \`
          <div class="prompt-container">
            <img src="${t.icon}" />
            <h1>${t.name}</h1>
            <p>\${args.title}</p>
            <button>\${args.button}</button>
          </div>
        \`;

        return new Promise((resolve) => {
          root.querySelector("button")?.addEventListener("click", () => {
            root.innerHTML = "";
            resolve(true);
          });
        });
      }

      class ProxyWindow {
        constructor(url, features) {
          this.closed = false;
          this.windowIdPromise = window.selector.call("open", { url, features });

          window.addEventListener("message", async (event) => {            
            if (event.data.origin !== "${e}") return;
            if (!event.data.method?.startsWith("proxy-window:")) return;
            const method = event.data.method.replace("proxy-window:", "");
            if (method === "closed" && event.data.windowId === await this.id()) this.closed = true;
          });
        } 

        async id() {
          return await this.windowIdPromise;
        }

        async focus() {
          await window.selector.call("panel.focus", { windowId: await this.id() });
        }

        async postMessage(data) {
          window.selector.call("panel.postMessage", { windowId: await this.id(), data });
        }

        async close() {
          await window.selector.call("panel.close", { windowId: await this.id() });
        }
      }

      window.selector = {
        wallet: null,
        location: "${window.location.href}",
        nearConnectVersion: "${d.NEAR_CONNECT_VERSION}",
        
        outerHeight: ${window.outerHeight},
        screenY: ${window.screenY},
        outerWidth: ${window.outerWidth},
        screenX: ${window.screenX},

        providers: {
          mainnet: ${JSON.stringify(a.mainnet)},
          testnet: ${JSON.stringify(a.testnet)},
        },

        uuid() {
          return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
            const r = (Math.random() * 16) | 0;
            const v = c === "x" ? r : (r & 0x3) | 0x8;
            return v.toString(16);
          });
        },

        walletConnect: {
          connect(params) {
            return window.selector.call("walletConnect.connect", params);
          },
          disconnect(params) {
            return window.selector.call("walletConnect.disconnect", params);
          },
          request(params) {
            return window.selector.call("walletConnect.request", params);
          },
          getProjectId() {
            return window.selector.call("walletConnect.getProjectId", {});
          },
          getSession() {
            return window.selector.call("walletConnect.getSession", {});
          },
        },
      
        async ready(wallet) {
          wallet.manifest = ${JSON.stringify(t)};
          window.parent.postMessage({ method: "wallet-ready", origin: "${e}" }, "*");
          window.selector.wallet = wallet;
        },

        async call(method, params) {
          const id = window.selector.uuid();
          window.parent.postMessage({ method, params, id, origin: "${e}" }, "*");

          return new Promise((resolve, reject) => {
            const handler = (event) => {
              if (event.data.id !== id || event.data.origin !== "${e}") return;
              window.removeEventListener("message", handler);

              if (event.data.status === "failed") reject(event.data.result);
              else resolve(event.data.result);
            };

            window.addEventListener("message", handler);
          });
        },

        panelClosed(windowId) {
          window.parent.postMessage({ 
            method: "panel.closed", 
            origin: "${e}", 
            result: { windowId } 
          }, "*");
        },

        open(url, _, params) {
          return new ProxyWindow(url, params)
        },

        external(entity, key, ...args) {
          return window.selector.call("external", { entity, key, args: args || [] });
        },

        openNativeApp(url) {
          return window.selector.call("open.nativeApp", { url });
        },

        ui: {
          async whenApprove(options) {
            window.selector.ui.showIframe();
            await showPrompt(options);
            window.selector.ui.hideIframe();
          },

          async showIframe() {
            return await window.selector.call("ui.showIframe");
          },

          async hideIframe() {
            return await window.selector.call("ui.hideIframe");
          },
        },

        storage: {
          async set(key, value) {
            await window.selector.call("storage.set", { key, value });
          },
      
          async get(key) {
            return await window.selector.call("storage.get", { key });
          },
      
          async remove(key) {
            await window.selector.call("storage.remove", { key });
          },

          async keys() {
            return await window.selector.call("storage.keys", {});
          },
        },
      };

      // Clipboard API often rejects inside the sandbox (Android WebView), copy through the dApp page then.
      // Plain assignment to navigator.clipboard is a no-op (getter on the prototype), so redefine the method
      const clipboard = navigator.clipboard || {};
      const nativeWriteText = clipboard.writeText ? clipboard.writeText.bind(clipboard) : null;
      Object.defineProperty(clipboard, "writeText", {
        configurable: true,
        value: async (text) => {
          try {
            if (nativeWriteText) return await nativeWriteText(text);
          } catch {}
          await window.selector.call("clipboard.writeText", { text });
        },
      });
      if (!navigator.clipboard) Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });

      window.addEventListener("message", async (event) => {
        if (event.data.origin !== "${e}") return;
        if (!event.data.method?.startsWith("wallet:")) return;
      
        const wallet = window.selector.wallet;
        const method = event.data.method.replace("wallet:", "");
        const payload = { id: event.data.id, origin: "${e}", method };
      
        if (wallet == null || typeof wallet[method] !== "function") {
          const data = { ...payload, status: "failed", result: "Method not found" };
          window.parent.postMessage(data, "*");
          return;
        }
        
        try {
          const result = await wallet[method](event.data.params);
          window.parent.postMessage({ ...payload, status: "success", result }, "*");
        } catch (error) {
          const data = { ...payload, status: "failed", result: error };
          window.parent.postMessage(data, "*");
        }
      });
      <\/script>

      <script type="module"${l}>${n}<\/script>
    </body>
  </html>
    `}return z.default=i,z}var me;function Fe(){if(me)return E;me=1;var d=E&&E.__importDefault||function(e){return e&&e.__esModule?e:{default:e}};Object.defineProperty(E,"__esModule",{value:!0});const i=_e(),s=Z(),h=Ke(),a=d(De());class t{constructor(n,l,u,c){m(this,"executor");m(this,"origin");m(this,"disposed",!1);m(this,"iframe",document.createElement("iframe"));m(this,"events",new i.EventEmitter);m(this,"popup");m(this,"handler");m(this,"readyPromiseResolve");m(this,"readyPromise",new Promise(n=>{this.readyPromiseResolve=n}));this.executor=n,this.origin=(0,s.uuid4)(),this.handler=r=>{r.data.origin===this.origin&&(r.data.method==="wallet-ready"&&this.readyPromiseResolve(),u(this,r))},window.addEventListener("message",this.handler);const g=[];this.executor.checkPermissions("usb")&&g.push("usb *;"),this.executor.checkPermissions("hid")&&g.push("hid *;"),this.executor.checkPermissions("clipboardRead")&&g.push("clipboard-read;"),this.executor.checkPermissions("clipboardWrite")&&g.push("clipboard-write;"),this.executor.checkPermissions("bluetooth")&&g.push("bluetooth *;"),this.iframe.allow=g.join(" "),this.iframe.setAttribute("sandbox","allow-scripts"),(0,a.default)({id:this.origin,executor:this.executor,code:l,cspNonce:c}).then(r=>{var o;(o=this.executor.connector.logger)==null||o.log("Iframe code injected"),this.iframe.srcdoc=r}),this.popup=new h.IframeWalletPopup({footer:this.executor.connector.footerBranding,iframe:this.iframe,onApprove:()=>{},onReject:()=>{this.disposed=!0,window.removeEventListener("message",this.handler),this.events.emit("close",{}),this.popup.destroy()}}),this.popup.create()}on(n,l){this.events.on(n,l)}show(){this.popup.show()}hide(){this.popup.hide()}postMessage(n){if(this.disposed)return;const l=this.iframe.contentWindow;if(!l)throw new Error(`Iframe not loaded for ${(n==null?void 0:n.method)??"unknown method"}`);l.postMessage({...n,origin:this.origin},"*")}dispose(){this.disposed=!0,window.removeEventListener("message",this.handler),this.popup.destroy()}}return E.default=t,E}var pe;function Re(){if(pe)return I;pe=1;var d=I&&I.__importDefault||function(l){return l&&l.__esModule?l:{default:l}};Object.defineProperty(I,"__esModule",{value:!0});const i=Pe(),s=Z(),h=Oe(),a=Te(),t=d(Fe()),e=(0,s.uuid4)();class n{constructor(u,c){m(this,"connector");m(this,"manifest");m(this,"activePanels",{});m(this,"storageSpace");m(this,"_onMessage",async(u,c)=>{const g=o=>{u.postMessage({...c.data,status:"success",result:o})},r=o=>{u.postMessage({...c.data,status:"failed",result:o})};if(c.data.method==="ui.showIframe"){u.show(),g(null);return}if(c.data.method==="ui.hideIframe"){u.hide(),g(null);return}if(c.data.method==="storage.set"){this.assertPermissions(u,"storage",c),localStorage.setItem(`${this.storageSpace}:${c.data.params.key}`,c.data.params.value),g(null);return}if(c.data.method==="storage.get"){this.assertPermissions(u,"storage",c);const o=localStorage.getItem(`${this.storageSpace}:${c.data.params.key}`);g(o);return}if(c.data.method==="storage.keys"){this.assertPermissions(u,"storage",c);const o=Object.keys(localStorage).filter(f=>f.startsWith(`${this.storageSpace}:`));g(o);return}if(c.data.method==="storage.remove"){this.assertPermissions(u,"storage",c),localStorage.removeItem(`${this.storageSpace}:${c.data.params.key}`),g(null);return}if(c.data.method==="panel.focus"){const o=this.activePanels[c.data.params.windowId];o&&o.focus(),g(null);return}if(c.data.method==="panel.postMessage"){const o=this.activePanels[c.data.params.windowId];o&&o.postMessage(c.data.params.data,"*"),g(null);return}if(c.data.method==="panel.close"){const o=this.activePanels[c.data.params.windowId];o&&o.close(),delete this.activePanels[c.data.params.windowId],g(null);return}if(c.data.method==="walletConnect.connect"){this.assertPermissions(u,"walletConnect",c);try{if(!this.connector.walletConnect)throw new Error("WalletConnect is not configured");const f=await(await this.connector.walletConnect).connect(c.data.params);f.approval(),g({uri:f.uri})}catch(o){r(o)}return}if(c.data.method==="walletConnect.getProjectId"){if(!this.connector.walletConnect)throw new Error("WalletConnect is not configured");this.assertPermissions(u,"walletConnect",c);const o=await this.connector.walletConnect;g(o.core.projectId);return}if(c.data.method==="walletConnect.disconnect"){this.assertPermissions(u,"walletConnect",c);try{if(!this.connector.walletConnect)throw new Error("WalletConnect is not configured");const f=await(await this.connector.walletConnect).disconnect(c.data.params);g(f)}catch(o){r(o)}return}if(c.data.method==="walletConnect.getSession"){this.assertPermissions(u,"walletConnect",c);try{if(!this.connector.walletConnect)throw new Error("WalletConnect is not configured");const o=await this.connector.walletConnect,f=o.session.keys[o.session.keys.length-1],w=f?o.session.get(f):null;g(w?{topic:w.topic,namespaces:w.namespaces}:null)}catch(o){r(o)}return}if(c.data.method==="walletConnect.request"){this.assertPermissions(u,"walletConnect",c);try{if(!this.connector.walletConnect)throw new Error("WalletConnect is not configured");const f=await(await this.connector.walletConnect).request(c.data.params);g(f)}catch(o){r(o)}return}if(c.data.method==="clipboard.writeText"){this.assertPermissions(u,"clipboardWrite",c);try{await(0,h.copyText)(c.data.params.text),g(null)}catch(o){r(o)}return}if(c.data.method==="external"){this.assertPermissions(u,"external",c);try{const{entity:o,key:f,args:w}=c.data.params,p=o.split(".").reduce((v,k)=>v[k],window);o==="nightly.near"&&f==="signTransaction"&&(w[0].encode=()=>w[0]);const y=typeof p[f]=="function"?await p[f](...w||[]):p[f];g(y)}catch(o){r(o)}return}if(c.data.method==="open"){this.assertPermissions(u,"allowsOpen",c);const o=(0,i.parseUrl)(c.data.params.url);if(o&&o.protocol==="https:"&&(0,a.isTelegramMiniApp)()){o.hostname==="t.me"?(0,a.openTelegramLink)(o):(0,a.openExternalLink)(o),g(null);return}const f=window.open(c.data.params.url,"_blank",c.data.params.features),w=f?(0,s.uuid4)():null,p=y=>{const v=(0,i.parseUrl)(c.data.params.url);v&&v.origin===y.origin&&u.postMessage(y.data)};if(g(w),window.addEventListener("message",p),f&&w){this.activePanels[w]=f;const y=setInterval(()=>{if(!(f!=null&&f.closed))return;window.removeEventListener("message",p);const v={method:"proxy-window:closed",windowId:w};delete this.activePanels[w],clearInterval(y);try{u.postMessage(v)}catch{}},500)}return}if(c.data.method==="open.nativeApp"){this.assertPermissions(u,"allowsOpen",c);const o=(0,i.parseUrl)(c.data.params.url);if(!o||["https","http","javascript:","file:","data:","blob:","about:"].includes(o.protocol))throw r("Invalid URL"),new Error("[open.nativeApp] Invalid URL");const w=document.createElement("iframe");w.src=c.data.params.url,w.style.display="none",document.body.appendChild(w),u.postMessage({...c.data,status:"success",result:null});return}});m(this,"actualCode",null);this.connector=u,this.manifest=c,this.storageSpace=c.id}checkPermissions(u,c){if(u==="walletConnect")return!!this.manifest.permissions.walletConnect;if(u==="external"){const g=this.manifest.permissions.external;return!g||!(c!=null&&c.entity)?!1:g.includes(c.entity)}if(u==="allowsOpen"){const g=(0,i.parseUrl)((c==null?void 0:c.url)||""),r=this.manifest.permissions.allowsOpen;return!g||!r||!Array.isArray(r)||r.length===0?!1:r.some(f=>{const w=(0,i.parseUrl)(f);return!(!w||g.protocol!==w.protocol||w.hostname&&g.hostname!==w.hostname||w.pathname&&w.pathname!=="/"&&g.pathname!==w.pathname)})}return this.manifest.permissions[u]}assertPermissions(u,c,g){if(!this.checkPermissions(c,g.data.params))throw u.postMessage({...g.data,status:"failed",result:"Permission denied"}),new Error("Permission denied")}async checkNewVersion(u,c){var o,f,w;if(this.actualCode)return(o=this.connector.logger)==null||o.log("New version of code already checked"),this.actualCode;let g=(0,i.parseUrl)(u.manifest.executor);if(g||(g=(0,i.parseUrl)(location.origin+u.manifest.executor)),!g)throw new Error("Invalid executor URL");g.searchParams.set("nonce",e);const r=await fetch(g.toString()).then(p=>{if(!p.ok)throw new Error(`Failed to load executor: ${p.status}`);return p.text()});return(f=this.connector.logger)==null||f.log("New version of code fetched"),this.actualCode=r,r===c?((w=this.connector.logger)==null||w.log("New version of code is the same as the current version"),this.actualCode):(await this.connector.db.setItem(`${this.manifest.id}:${this.manifest.version}`,r).then(()=>{var p;return(p=this.connector.logger)==null?void 0:p.log("New version of code saved to cache")}).catch(p=>{var y;return(y=this.connector.logger)==null?void 0:y.log("Failed to cache new version of code",p)}),r)}async loadCode(){var g;const u=await this.connector.db.getItem(`${this.manifest.id}:${this.manifest.version}`).catch(()=>null);(g=this.connector.logger)==null||g.log("Code loaded from cache",u!==null);const c=this.checkNewVersion(this,u);return u||await c}async call(u,c){var f,w,p,y,v;(f=this.connector.logger)==null||f.log("Add to queue",u,c),(w=this.connector.logger)==null||w.log("Calling method",u,c);const g=await this.loadCode();(p=this.connector.logger)==null||p.log("Code loaded, preparing");const r=new t.default(this,g,this._onMessage,this.connector.cspNonce);(y=this.connector.logger)==null||y.log("Code loaded, iframe initialized"),await r.readyPromise,(v=this.connector.logger)==null||v.log("Iframe ready");const o=(0,s.uuid4)();return new Promise((k,A)=>{var x;try{const S=b=>{var M;b.data.id!==o||b.data.origin!==r.origin||(r.dispose(),window.removeEventListener("message",S),(M=this.connector.logger)==null||M.log("postMessage",{result:b.data,request:{method:u,params:c}}),b.data.status==="failed"?A(b.data.result):k(b.data.result))};window.addEventListener("message",S),r.postMessage({method:u,params:c,id:o}),r.on("close",()=>A(new Error("Wallet closed")))}catch(S){(x=this.connector.logger)==null||x.log("Iframe error",S),A(S)}})}async getAllStorage(){const u=Object.keys(localStorage).filter(g=>g.startsWith(`${this.storageSpace}:`)),c={};for(const g of u)c[g.replace(`${this.storageSpace}:`,"")]=localStorage.getItem(g);return c}async clearStorage(){const u=Object.keys(localStorage).filter(c=>c.startsWith(`${this.storageSpace}:`));for(const c of u)localStorage.removeItem(c)}}return I.default=n,I}var ye;function Ee(){if(ye)return P;ye=1;var d=P&&P.__importDefault||function(t){return t&&t.__esModule?t:{default:t}};Object.defineProperty(P,"__esModule",{value:!0}),P.SandboxWallet=void 0;const i=J(),s=V(),h=d(Re());class a{constructor(e,n){m(this,"connector");m(this,"manifest");m(this,"executor");this.connector=e,this.manifest=n,this.executor=new h.default(e,n)}async signIn(e){return this.executor.call("wallet:signIn",{network:(e==null?void 0:e.network)??this.connector.network,addFunctionCallKey:e==null?void 0:e.addFunctionCallKey})}async signInAndSignMessage(e){return this.executor.call("wallet:signInAndSignMessage",{network:(e==null?void 0:e.network)??this.connector.network,addFunctionCallKey:e==null?void 0:e.addFunctionCallKey,messageParams:e.messageParams})}async signOut(e){const n={...e,network:(e==null?void 0:e.network)??this.connector.network};await this.executor.call("wallet:signOut",n),await this.executor.clearStorage()}async getAccounts(e){const n={...e,network:(e==null?void 0:e.network)??this.connector.network};return this.executor.call("wallet:getAccounts",n)}async signAndSendTransaction(e){const n=(0,i.nearActionsToConnectorActions)(e.actions);(0,s.assertGasKeyActionsSupported)(this.manifest.features,n,this.manifest.name);const l={...e,actions:n,network:e.network??this.connector.network};return this.executor.call("wallet:signAndSendTransaction",l)}async signAndSendTransactions(e){const n=e.transactions.map(u=>({actions:(0,i.nearActionsToConnectorActions)(u.actions),receiverId:u.receiverId}));(0,s.assertGasKeyActionsSupported)(this.manifest.features,n.flatMap(u=>u.actions),this.manifest.name);const l={...e,transactions:n,network:e.network??this.connector.network};return this.executor.call("wallet:signAndSendTransactions",l)}async signMessage(e){const n={...e,network:e.network??this.connector.network};return this.executor.call("wallet:signMessage",n)}async signDelegateActions(e){const n={...e,delegateActions:e.delegateActions.map(l=>({...l,actions:(0,i.nearActionsToConnectorActions)(l.actions)})),network:e.network??this.connector.network};return(0,s.assertGasKeyActionsSupported)(this.manifest.features,n.delegateActions.flatMap(l=>l.actions),this.manifest.name),this.executor.call("wallet:signDelegateActions",n)}}return P.SandboxWallet=a,P.default=a,P}var G={},be;function Me(){if(be)return G;be=1,Object.defineProperty(G,"__esModule",{value:!0}),G.InjectedWallet=void 0;const d=J(),i=V();let s=class{constructor(a,t){m(this,"connector");m(this,"wallet");this.connector=a,this.wallet=t}get manifest(){return this.wallet.manifest}async signIn({addFunctionCallKey:a,network:t}){return this.wallet.signIn({network:t??this.connector.network,addFunctionCallKey:a})}async signInAndSignMessage(a){return this.wallet.signInAndSignMessage({network:(a==null?void 0:a.network)??this.connector.network,addFunctionCallKey:a.addFunctionCallKey,messageParams:a.messageParams})}async signOut(a){await this.wallet.signOut({network:(a==null?void 0:a.network)??this.connector.network})}async getAccounts(a){return this.wallet.getAccounts({network:(a==null?void 0:a.network)??this.connector.network})}async signAndSendTransaction(a){const t=(0,d.nearActionsToConnectorActions)(a.actions);(0,i.assertGasKeyActionsSupported)(this.manifest.features,t,this.manifest.name);const e=a.network??this.connector.network,n=await this.wallet.signAndSendTransaction({...a,actions:t,network:e});if(!n)throw new Error("No result from wallet");return Array.isArray(n.transactions)?n.transactions[0]:n}async signAndSendTransactions(a){const t=a.network??this.connector.network,e=a.transactions.map(l=>({actions:(0,d.nearActionsToConnectorActions)(l.actions),receiverId:l.receiverId}));(0,i.assertGasKeyActionsSupported)(this.manifest.features,e.flatMap(l=>l.actions),this.manifest.name);const n=await this.wallet.signAndSendTransactions({...a,transactions:e,network:t});if(!n)throw new Error("No result from wallet");return Array.isArray(n.transactions)?n.transactions:n}async signMessage(a){return this.wallet.signMessage({...a,network:a.network??this.connector.network})}async signDelegateActions(a){const t=a.delegateActions.map(e=>({...e,actions:(0,d.nearActionsToConnectorActions)(e.actions)}));return(0,i.assertGasKeyActionsSupported)(this.manifest.features,t.flatMap(e=>e.actions),this.manifest.name),this.wallet.signDelegateActions({...a,delegateActions:t,network:a.network??this.connector.network})}};return G.InjectedWallet=s,G}var _={},U={},ve;function Ge(){if(ve)return U;ve=1,Object.defineProperty(U,"__esModule",{value:!0}),U.NearWalletsPopup=void 0;const d=Q(),i=Pe(),s=Ie(),h={id:"custom-wallet",name:"Custom Wallet",icon:"https://www.mynearwallet.com/images/webclip.png",description:"Custom wallet for NEAR.",website:"",version:"1.0.0",executor:"your-executor-url.js",type:"sandbox",platform:{},features:{signMessage:!0,signInWithoutAddKey:!0,signInAndSignMessage:!0,signAndSendTransaction:!0,signAndSendTransactions:!0,signDelegateActions:!0},permissions:{storage:!0,allowsOpen:[]}};let a=class extends s.Popup{constructor(n){super(n);m(this,"delegate");this.delegate=n,this.update({wallets:n.wallets,showSettings:!1})}handlers(){super.handlers(),this.addListener(".settings-button","click",()=>this.update({showSettings:!0})),this.addListener(".back-button","click",()=>this.update({showSettings:!1})),this.root.querySelectorAll(".connect-item").forEach(n=>{n instanceof HTMLDivElement&&this.addListener(n,"click",()=>this.delegate.onSelect(n.dataset.type))}),this.root.querySelectorAll(".remove-wallet-button").forEach(n=>{n instanceof SVGSVGElement&&this.addListener(n,"click",async l=>{l.stopPropagation(),await this.delegate.onRemoveDebugManifest(n.dataset.type);const u=this.state.wallets.filter(c=>c.id!==n.dataset.type);this.update({wallets:u})})}),this.addListener(".add-debug-manifest-button","click",async()=>{var n;try{const l=((n=this.root.querySelector("#debug-manifest-input"))==null?void 0:n.value)??"",u=await this.delegate.onAddDebugManifest(l);this.update({showSettings:!1,wallets:[u,...this.state.wallets]})}catch(l){alert(`Something went wrong: ${l}`)}})}create(){super.create({show:!0})}walletDom(n){var u;const l=(0,d.html)`
      <svg
        class="remove-wallet-button"
        data-type="${n.id}"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style="margin-right: 4px;"
      >
        <path d="M18 6L6 18" stroke="rgba(255,255,255,0.5)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M6 6L18 18" stroke="rgba(255,255,255,0.5)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    `;return(0,d.html)`
      <div class="connect-item" data-type="${n.id}">
        <img style="background: #333" src="${n.icon}" alt="${n.name}" />
        <div class="connect-item-info">
          <span>${n.name}</span>
          <span class="wallet-address">${(u=(0,i.parseUrl)(n.website))==null?void 0:u.hostname}</span>
        </div>
        ${n.debug?l:""}
      </div>
    `}get footer(){if(!this.delegate.footer)return"";const{icon:n,heading:l,link:u,linkText:c}=this.delegate.footer;return(0,d.html)`
      <div class="footer">
        ${n?(0,d.html)`<img src="${n}" alt="${l}" />`:""}
        <p>${l}</p>
        <a class="get-wallet-link" href="${u}" target="_blank">${c}</a>
      </div>
    `}get dom(){return this.state.showSettings?(0,d.html)`
        <div class="modal-container">
          <div class="modal-content">
            <div class="modal-header">
              <button class="back-button" style="left: 16px; right: unset;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M15 18L9 12L15 6" stroke="rgba(255,255,255,0.5)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
              <p>Settings</p>
            </div>

            <div class="modal-body">
              <p style="text-align: left;">
                You can add your wallet to dapp for debug,
                <a href="https://github.com/azbang/hot-connector" target="_blank">read the documentation.</a> Paste your manifest and click "Add".
              </p>

              <textarea style="width: 100%;" id="debug-manifest-input" rows="10">${JSON.stringify(h,null,2)}</textarea>
              <button class="add-debug-manifest-button">Add</button>
            </div>

            ${this.footer}
          </div>
        </div>
      `:(0,d.html)`<div class="modal-container">
      <div class="modal-content">
        <div class="modal-header">
          <p>Select wallet</p>
          <button class="settings-button">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="2" fill="rgba(255,255,255,0.5)" />
              <circle cx="19" cy="12" r="2" fill="rgba(255,255,255,0.5)" />
              <circle cx="5" cy="12" r="2" fill="rgba(255,255,255,0.5)" />
            </svg>
          </button>
        </div>

        <div class="modal-body">${this.state.wallets.map(n=>this.walletDom(n))}</div>

        ${this.footer}
      </div>
    </div>`}};return U.NearWalletsPopup=a,U}var H={},xe;function Ue(){if(xe)return H;xe=1,Object.defineProperty(H,"__esModule",{value:!0});class d{constructor(s,h){m(this,"dbName");m(this,"storeName");m(this,"version");this.dbName=s,this.storeName=h,this.version=1}getDb(){return new Promise((s,h)=>{if(typeof window>"u"||typeof indexedDB>"u"){h(new Error("IndexedDB is not available (SSR environment)"));return}const a=indexedDB.open(this.dbName,this.version);a.onerror=t=>{console.error("Error opening database:",t.target.error),h(new Error("Error opening database"))},a.onsuccess=t=>{s(a.result)},a.onupgradeneeded=t=>{const e=a.result;e.objectStoreNames.contains(this.storeName)||e.createObjectStore(this.storeName)}})}async getItem(s){const h=await this.getDb();if(typeof s=="number"&&(s=s.toString()),typeof s!="string")throw new Error("Key must be a string");return new Promise((a,t)=>{if(!this.storeName){t(new Error("Store name not set"));return}const e=h.transaction(this.storeName,"readonly");e.onerror=u=>t(e.error);const l=e.objectStore(this.storeName).get(s);l.onerror=u=>t(l.error),l.onsuccess=()=>{a(l.result),h.close()}})}async setItem(s,h){const a=await this.getDb();if(typeof s=="number"&&(s=s.toString()),typeof s!="string")throw new Error("Key must be a string");return new Promise((t,e)=>{if(!this.storeName){e(new Error("Store name not set"));return}const n=a.transaction(this.storeName,"readwrite");n.onerror=c=>e(n.error);const u=n.objectStore(this.storeName).put(h,s);u.onerror=c=>e(u.error),u.onsuccess=()=>{a.close(),t()}})}async removeItem(s){const h=await this.getDb();if(typeof s=="number"&&(s=s.toString()),typeof s!="string")throw new Error("Key must be a string");return new Promise((a,t)=>{if(!this.storeName){t(new Error("Store name not set"));return}const e=h.transaction(this.storeName,"readwrite");e.onerror=u=>t(e.error);const l=e.objectStore(this.storeName).delete(s);l.onerror=u=>t(l.error),l.onsuccess=()=>{h.close(),a()}})}async keys(){const s=await this.getDb();return new Promise((h,a)=>{if(!this.storeName){a(new Error("Store name not set"));return}const t=s.transaction(this.storeName,"readonly");t.onerror=l=>a(t.error);const n=t.objectStore(this.storeName).getAllKeys();n.onerror=l=>a(n.error),n.onsuccess=()=>{h(n.result),s.close()}})}async count(){const s=await this.getDb();return new Promise((h,a)=>{if(!this.storeName){a(new Error("Store name not set"));return}const t=s.transaction(this.storeName,"readonly");t.onerror=l=>a(t.error);const n=t.objectStore(this.storeName).count();n.onerror=l=>a(n.error),n.onsuccess=()=>{h(n.result),s.close()}})}async length(){return this.count()}async clear(){const s=await this.getDb();return new Promise((h,a)=>{if(!this.storeName){a(new Error("Store name not set"));return}const t=s.transaction(this.storeName,"readwrite");t.onerror=l=>a(t.error);const n=t.objectStore(this.storeName).clear();n.onerror=l=>a(n.error),n.onsuccess=()=>{s.close(),h()}})}}return H.default=d,H}var ke;function Be(){if(ke)return _;ke=1;var d=_&&_.__importDefault||function(g){return g&&g.__esModule?g:{default:g}};Object.defineProperty(_,"__esModule",{value:!0}),_.NearConnector=void 0;const i=_e(),s=Ge(),h=Se(),a=d(Ue()),t=Ce(),e=Me(),n=Ee(),l=["https://raw.githubusercontent.com/hot-dao/near-selector/refs/heads/main/repository/manifest.json","https://cdn.jsdelivr.net/gh/azbang/hot-connector/repository/manifest.json"];function u(g){return r=>Object.entries(g).length===0?!0:Object.entries(g).filter(([o,f])=>f===!0).every(([o])=>{var f;return((f=r.manifest.features)==null?void 0:f[o])===!0})}let c=class{constructor(r){m(this,"storage");m(this,"events");m(this,"db");m(this,"logger");m(this,"wallets",[]);m(this,"manifest",{wallets:[],version:"1.0.0"});m(this,"features",{});m(this,"network","mainnet");m(this,"providers",{mainnet:[],testnet:[]});m(this,"walletConnect");m(this,"footerBranding");m(this,"excludedWallets",[]);m(this,"autoConnect");m(this,"cspNonce");m(this,"whenManifestLoaded");m(this,"_handleNearWalletInjected",r=>{this.wallets=this.wallets.filter(o=>o.manifest.id!==r.detail.manifest.id),this.wallets.unshift(new e.InjectedWallet(this,r.detail)),this.events.emit("selector:walletsChanged",{})});this.db=new a.default("hot-connector","wallets"),this.storage=(r==null?void 0:r.storage)??new h.LocalStorage,this.events=(r==null?void 0:r.events)??new i.EventEmitter,this.logger=r==null?void 0:r.logger,this.cspNonce=r==null?void 0:r.cspNonce,this.network=(r==null?void 0:r.network)??"mainnet",this.walletConnect=r==null?void 0:r.walletConnect,this.autoConnect=(r==null?void 0:r.autoConnect)??!0,this.providers=(r==null?void 0:r.providers)??{mainnet:[],testnet:[]},this.excludedWallets=(r==null?void 0:r.excludedWallets)??[],this.features=(r==null?void 0:r.features)??{},(r==null?void 0:r.footerBranding)!==void 0?this.footerBranding=r==null?void 0:r.footerBranding:this.footerBranding={icon:"data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%20512%20512%22%20class%3D%22size-7%22%3E%3Crect%20width%3D%22512%22%20height%3D%22512%22%20fill%3D%22%2300ec97%22%20rx%3D%22110%22%2F%3E%3Cpath%20fill%3D%22%23000%22%20d%3D%22M373.89%20106.199a31.95%2031.95%200%200%200-27.213%2015.207l-62.631%2092.979a6.67%206.67%200%200%200-.989%205.001%206.66%206.66%200%200%200%202.837%204.235%206.67%206.67%200%200%200%208.032-.494l61.643-53.47c1.02-.924%202.599-.827%203.523.193.419.473.644%201.074.644%201.697v167.402a2.49%202.49%200%200%201-2.502%202.491%202.48%202.48%200%200%201-1.912-.891L168.976%20117.497a31.93%2031.93%200%200%200-24.356-11.298h-6.508c-17.623%200-31.917%2014.294-31.917%2031.917v235.767c0%2017.623%2014.294%2031.917%2031.917%2031.917a31.94%2031.94%200%200%200%2027.213-15.206l62.631-92.98a6.66%206.66%200%200%200-1.847-9.236%206.67%206.67%200%200%200-8.033.494l-61.643%2053.471c-1.02.923-2.599.826-3.522-.194a2.5%202.5%200%200%201-.634-1.697V173.008a2.49%202.49%200%200%201%202.502-2.492c.731%200%201.439.322%201.912.891l186.313%20223.096a31.95%2031.95%200%200%200%2024.357%2011.297h6.508c17.623%200%2031.927-14.272%2031.938-31.895V138.116c0-17.623-14.294-31.917-31.917-31.917%22%2F%3E%3C%2Fsvg%3E",heading:"NEAR Connector",link:"https://wallet.near.org",linkText:"Don't have a wallet?"},this.whenManifestLoaded=new Promise(async o=>{(r==null?void 0:r.manifest)==null||typeof r.manifest=="string"?this.manifest=await this._loadManifest(r==null?void 0:r.manifest).catch(()=>({wallets:[],version:"1.0.0"})):this.manifest=(r==null?void 0:r.manifest)??{wallets:[],version:"1.0.0"};const f=new Set(this.excludedWallets);f.delete("hot-wallet"),this.manifest.wallets=this.manifest.wallets.filter(w=>!(w.permissions.walletConnect&&!this.walletConnect||f.has(w.id))),await new Promise(w=>setTimeout(w,100)),o()}),typeof window<"u"&&(window.addEventListener("near-wallet-injected",this._handleNearWalletInjected),window.dispatchEvent(new Event("near-selector-ready")),window.addEventListener("message",async o=>{o.data.type==="near-wallet-injected"&&(await this.whenManifestLoaded.catch(()=>{}),this.wallets=this.wallets.filter(f=>f.manifest.id!==o.data.manifest.id),this.wallets.unshift(new t.ParentFrameWallet(this,o.data.manifest)),this.events.emit("selector:walletsChanged",{}),this.autoConnect&&this.connect({walletId:o.data.manifest.id}))})),this.whenManifestLoaded.then(()=>{typeof window<"u"&&window.parent.postMessage({type:"near-selector-ready"},"*"),this.manifest.wallets.forEach(o=>this.registerWallet(o)),this.storage.get("debug-wallets").then(o=>{JSON.parse(o??"[]").forEach(w=>this.registerDebugWallet(w))})})}get availableWallets(){return this.wallets.filter(o=>Object.entries(this.features).every(([f,w])=>{var p;return!(w&&!((p=o.manifest.features)!=null&&p[f]))})).filter(o=>{var f;return!(this.network==="testnet"&&!((f=o.manifest.features)!=null&&f.testnet))})}async _loadManifest(r){const o=r?[r]:l;for(const f of o){const w=await fetch(f).catch(()=>null);if(!(!w||!w.ok))return await w.json()}throw new Error("Failed to load manifest")}async switchNetwork(r,o){this.network!==r&&(await this.disconnect().catch(()=>{}),this.network=r,await this.connect(o))}async registerWallet(r){if(r.type!=="sandbox")throw new Error("Only sandbox wallets are supported");this.wallets.find(o=>o.manifest.id===r.id)||(this.wallets.push(new n.SandboxWallet(this,r)),this.events.emit("selector:walletsChanged",{}))}async registerDebugWallet(r){const o=typeof r=="string"?JSON.parse(r):r;if(o.type!=="sandbox")throw new Error("Only sandbox wallets type are supported");if(!o.id)throw new Error("Manifest must have an id");if(!o.name)throw new Error("Manifest must have a name");if(!o.icon)throw new Error("Manifest must have an icon");if(!o.website)throw new Error("Manifest must have a website");if(!o.version)throw new Error("Manifest must have a version");if(!o.executor)throw new Error("Manifest must have an executor");if(!o.features)throw new Error("Manifest must have features");if(!o.permissions)throw new Error("Manifest must have permissions");if(this.wallets.find(w=>w.manifest.id===o.id))throw new Error("Wallet already registered");o.debug=!0,this.wallets.unshift(new n.SandboxWallet(this,o)),this.events.emit("selector:walletsChanged",{});const f=this.wallets.filter(w=>w.manifest.debug).map(w=>w.manifest);return this.storage.set("debug-wallets",JSON.stringify(f)),o}async removeDebugWallet(r){this.wallets=this.wallets.filter(f=>f.manifest.id!==r);const o=this.wallets.filter(f=>f.manifest.debug).map(f=>f.manifest);this.storage.set("debug-wallets",JSON.stringify(o)),this.events.emit("selector:walletsChanged",{})}async selectWallet({features:r={}}={}){return await this.whenManifestLoaded.catch(()=>{}),new Promise((o,f)=>{const w=new s.NearWalletsPopup({footer:this.footerBranding,wallets:this.availableWallets.filter(u(r)).map(p=>p.manifest),onRemoveDebugManifest:async p=>this.removeDebugWallet(p),onAddDebugManifest:async p=>this.registerDebugWallet(p),onReject:()=>(f(new Error("User rejected")),w.destroy()),onSelect:p=>(o(p),w.destroy())});w.create()})}async connect(r={}){var w,p,y,v,k,A;let o=r.walletId;const f=r.signMessageParams;await this.whenManifestLoaded.catch(()=>{}),o||(o=await this.selectWallet({features:{signInAndSignMessage:r.signMessageParams!=null?!0:void 0,signInWithFunctionCallKey:r.addFunctionCallKey!=null?!0:void 0}}));try{const x=await this.wallet(o);(w=this.logger)==null||w.log("Wallet available to connect",x),await this.storage.set("selected-wallet",o),(p=this.logger)==null||p.log(`Set preferred wallet, try to signIn${f!=null?" (with signed message)":""}`,o);let S;if(r.addFunctionCallKey!=null&&((y=this.logger)==null||y.log("Adding function call access key during sign in with params",r.addFunctionCallKey),S={...r.addFunctionCallKey,gasAllowance:r.addFunctionCallKey.gasAllowance??{amount:"250000000000000000000000",kind:"limited"}}),f!=null){const b=await x.signInAndSignMessage({addFunctionCallKey:S,messageParams:f,network:this.network});if(!(b!=null&&b.length))throw new Error("Failed to sign in");(v=this.logger)==null||v.log("Signed in to wallet (with signed message)",o,b),this.events.emit("wallet:signInAndSignMessage",{wallet:x,accounts:b,success:!0}),this.events.emit("wallet:signIn",{wallet:x,accounts:b.map(M=>({accountId:M.accountId,publicKey:M.publicKey})),success:!0,source:"signInAndSignMessage"})}else{const b=await x.signIn({addFunctionCallKey:S,network:this.network});if(!(b!=null&&b.length))throw new Error("Failed to sign in");(k=this.logger)==null||k.log("Signed in to wallet",o,b),this.events.emit("wallet:signIn",{wallet:x,accounts:b,success:!0,source:"signIn"})}return x}catch(x){throw(A=this.logger)==null||A.log("Failed to connect to wallet",x),x}}async disconnect(r){r||(r=await this.wallet()),await r.signOut({network:this.network}),await this.storage.remove("selected-wallet"),this.events.emit("wallet:signOut",{success:!0})}async getConnectedWallet(){await this.whenManifestLoaded.catch(()=>{});const r=await this.storage.get("selected-wallet"),o=this.wallets.find(w=>w.manifest.id===r);if(!o)throw new Error("No wallet selected");const f=await o.getAccounts();if(!(f!=null&&f.length))throw new Error("No accounts found");return{wallet:o,accounts:f}}async wallet(r){if(await this.whenManifestLoaded.catch(()=>{}),!r)return this.getConnectedWallet().then(({wallet:f})=>f).catch(async()=>{throw await this.storage.remove("selected-wallet"),new Error("No accounts found")});const o=this.wallets.find(f=>f.manifest.id===r);if(!o)throw new Error("Wallet not found");return o}async use(r){await this.whenManifestLoaded.catch(()=>{}),this.wallets=this.wallets.map(o=>new Proxy(o,{get(f,w,p){const y=Reflect.get(f,w,p);if(w in r&&typeof y=="function"){const v=r[w];return function(...k){const A=()=>y.apply(f,k);return k.length>0?v.call(this,...k,A):v.call(this,void 0,A)}}return y}}))}on(r,o){this.events.on(r,o)}once(r,o){this.events.once(r,o)}off(r,o){this.events.off(r,o)}removeAllListeners(r){this.events.removeAllListeners(r)}};return _.NearConnector=c,_}var Ae;function ze(){return Ae||(Ae=1,(function(d){Object.defineProperty(d,"__esModule",{value:!0}),d.assertGasKeyActionsSupported=d.isGasKeyAction=d.nearActionsToConnectorActions=d.NearConnector=d.InjectedWallet=d.SandboxWallet=d.ParentFrameWallet=d.LocalStorage=void 0;var i=Se();Object.defineProperty(d,"LocalStorage",{enumerable:!0,get:function(){return i.LocalStorage}});var s=Ce();Object.defineProperty(d,"ParentFrameWallet",{enumerable:!0,get:function(){return s.ParentFrameWallet}});var h=Ee();Object.defineProperty(d,"SandboxWallet",{enumerable:!0,get:function(){return h.SandboxWallet}});var a=Me();Object.defineProperty(d,"InjectedWallet",{enumerable:!0,get:function(){return a.InjectedWallet}});var t=Be();Object.defineProperty(d,"NearConnector",{enumerable:!0,get:function(){return t.NearConnector}});var e=J();Object.defineProperty(d,"nearActionsToConnectorActions",{enumerable:!0,get:function(){return e.nearActionsToConnectorActions}});var n=V();Object.defineProperty(d,"isGasKeyAction",{enumerable:!0,get:function(){return n.isGasKeyAction}}),Object.defineProperty(d,"assertGasKeyActionsSupported",{enumerable:!0,get:function(){return n.assertGasKeyActionsSupported}})})(Y)),Y}var He=ze();const tt=Ne({__proto__:null},[He]);export{tt as i};
