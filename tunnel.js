/* tunnel.js — 外网一键启动：本地游戏服务器 + Cloudflare 快速隧道（免注册）
 * 用法：node tunnel.js [端口]（默认 8080）
 * 首次运行自动下载 cloudflared 到 tools/（GitHub 直连失败会试镜像）
 * 每次启动会得到一个新的 https://xxx.trycloudflare.com 地址，发给任何人即可访问
 */
'use strict';
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const ROOT = __dirname;
const PORT = +(process.argv[2] || process.env.PORT || 8080);
const TOOLS = path.join(ROOT, 'tools');
const CF = path.join(TOOLS, 'cloudflared.exe');
const URL_FILE = path.join(ROOT, '.tunnel-url');

function log(msg) { console.log(msg); }
function big(msg) {
  const line = '═'.repeat(56);
  console.log('');
  console.log('  ' + line);
  (Array.isArray(msg) ? msg : [msg]).forEach((m) => console.log('  ' + m));
  console.log('  ' + line);
  console.log('');
}

/* ---------- 1. 确保 cloudflared 存在 ---------- */
function ensureCloudflared() {
  if (fs.existsSync(CF) && fs.statSync(CF).size > 10 * 1024 * 1024) return true;

  fs.mkdirSync(TOOLS, { recursive: true });
  const official = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
  const mirrors = [
    official,
    'https://ghproxy.cn/' + official,
    'https://gh-proxy.com/' + official,
    'https://mirror.ghproxy.com/' + official,
  ];
  const curl = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'curl.exe');

  log('⬇ 首次运行：正在下载穿透工具 cloudflared（约 50MB）…');
  for (const url of mirrors) {
    try {
      log('   尝试：' + url.split('/').slice(0, 3).join('/'));
      execFileSync(curl, ['-L', '--connect-timeout', '25', '--max-time', '300', '-o', CF, '-sS', url], { stdio: 'inherit' });
      if (fs.existsSync(CF) && fs.statSync(CF).size > 10 * 1024 * 1024) {
        log('✓ 下载完成');
        return true;
      }
    } catch (e) {
      log('   该源失败，换下一个…');
    }
  }
  fs.existsSync(CF) && fs.statSync(CF).size < 1024 * 1024 && fs.unlinkSync(CF);
  big([
    '✗ 自动下载失败（网络对 GitHub 不友好时常见）。',
    '请手动下载 cloudflared-windows-amd64.exe：',
    'https://github.com/cloudflare/cloudflared/releases/latest',
    '放到项目的 tools 文件夹里，文件名保持 cloudflared.exe，',
    '然后重新运行本脚本。也可以用手机下载后传到电脑。',
  ]);
  return false;
}

/* ---------- 2. 启动游戏服务器 ---------- */
function startServer() {
  const p = spawn(process.execPath, [path.join(ROOT, 'server.js'), String(PORT)], { cwd: ROOT });
  p.stdout.on('data', (d) => process.stdout.write('[游戏] ' + d));
  p.stderr.on('data', (d) => process.stderr.write('[游戏] ' + d));
  p.on('exit', (code) => {
    log('⚠ 游戏服务器已退出（code=' + code + '）');
    shutdown(1);
  });
  return p;
}

function waitServerReady(cb) {
  const t0 = Date.now();
  (function ping() {
    http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 1500 }, (res) => {
      res.resume();
      cb(true);
    }).on('error', () => {
      if (Date.now() - t0 > 15000) cb(false);
      else setTimeout(ping, 300);
    });
  })();
}

/* ---------- 3. 启动隧道并解析公网地址 ---------- */
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

function startTunnel(cb) {
  const p = spawn(CF, ['tunnel', '--url', 'http://127.0.0.1:' + PORT, '--no-autoupdate'], { cwd: TOOLS });
  let found = null;
  const onData = (d) => {
    const s = String(d);
    process.stderr.write('[隧道] ' + s);   // cloudflared 的输出在 stderr
    if (!found) {
      const m = s.match(URL_RE);
      if (m) {
        found = m[0];
        cb(null, found, p);
      }
    }
  };
  p.stderr.on('data', onData);
  p.stdout.on('data', onData);
  p.on('exit', (code) => {
    if (!found) cb(new Error('隧道进程退出（code=' + code + '）。可能是网络无法连到 Cloudflare，稍后重试或换网络。'));
    else shutdown(1);
  });
  setTimeout(() => { if (!found) cb(new Error('60 秒内未获得公网地址，请重试。')); }, 60000);
}

/* ---------- 4. 主流程 ---------- */
let serverP = null, tunnelP = null;
function shutdown(code) {
  try { fs.writeFileSync(URL_FILE, ''); } catch (e) {}
  const kill = (p) => {
    if (p && p.pid) {
      try { execFileSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {}
    }
  };
  kill(tunnelP); kill(serverP);
  process.exit(code == null ? 0 : code);
}
process.on('SIGINT', () => { log(''); log('正在退出…'); shutdown(0); });

function lanIPs() {
  const res = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const it of ifs[name]) if (it.family === 'IPv4' && !it.internal) res.push(it.address);
  }
  return res;
}

if (!ensureCloudflared()) process.exit(1);

log('▶ 启动游戏服务器（端口 ' + PORT + '）…');
serverP = startServer();

waitServerReady((ok) => {
  if (!ok) { big(['✗ 游戏服务器 15 秒内未就绪，请检查端口占用。']); shutdown(1); }
  log('✓ 游戏服务器已就绪');
  log('▶ 正在建立外网隧道…');
  startTunnel((err, url, p) => {
    if (err) { big(['✗ ' + err.message]); shutdown(1); }
    tunnelP = p;
    try { fs.writeFileSync(URL_FILE, url + '\n'); } catch (e) {}
    big([
      '🎉 外网通道已建立！把这个地址发给对方：',
      '',
      '     ' + url,
      '',
      ' · 对方在任何网络（家里/手机流量）打开即可对弈',
      ' · 联机进入「局域网联机」→ 房间码邀请，流程不变',
      ' · 本地址每次重启会变化，重启后请重新发送',
      ' · 局域网内同事仍可直接访问：',
      ...lanIPs().map((ip) => '     http://' + ip + ':' + PORT),
    ]);
    log('（关闭本窗口或按 Ctrl+C 即停止对外服务）');
  });
});
