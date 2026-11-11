// src/pages/*.dc.html → docs/*.html
// 캔버스 템플릿을 브라우저에서 바로 열리는 독립 HTML로 바꾼다 (외부 의존성 없음).
//   node build.mjs
import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'src/pages';
const OUT = 'docs';
mkdirSync(OUT, { recursive: true });
copyFileSync('src/runtime.js', join(OUT, 'runtime.js'));

const pick = (s, re, what, file) => {
  const m = s.match(re);
  if (!m) throw new Error(`${file}: ${what} 를 찾지 못함`);
  return m;
};
const decodeAttr = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const relink = (s) => s.replace(/\.dc\.html/g, '.html');

const files = readdirSync(SRC).filter((f) => f.endsWith('.dc.html')).sort();
for (const f of files) {
  const src = readFileSync(join(SRC, f), 'utf8');
  const lang = (src.match(/<html lang="([^"]+)"/) || [, 'ko'])[1];
  const title = pick(src, /<title>([\s\S]*?)<\/title>/, 'title', f)[1];
  const xdc = pick(src, /<x-dc>([\s\S]*?)<\/x-dc>/, '<x-dc>', f)[1];
  const helmet = (xdc.match(/<helmet>([\s\S]*?)<\/helmet>/) || [, ''])[1];
  const template = xdc.replace(/<helmet>[\s\S]*?<\/helmet>/, '');
  const sm = pick(src, /<script type="text\/x-dc" data-dc-script data-props='([^']*)'>([\s\S]*?)<\/script>/, 'component script', f);
  const props = JSON.parse(decodeAttr(sm[1]));
  if (template.includes('</script')) throw new Error(`${f}: 템플릿 안에 </script 가 있음`);

  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${helmet.trim()}
<script src="./runtime.js"></script>
</head>
<body>
<script type="text/x-dc-template" id="dc-template">
${relink(template.trim())}
</script>
<script>
window.__DC_PROPS = ${JSON.stringify(props)};
${relink(sm[2].trim())}
window.__DC_Component = Component;
</script>
</body>
</html>
`;
  const out = f.replace(/\.dc\.html$/, '.html');
  writeFileSync(join(OUT, out), html);
  console.log(`  ${f} → ${OUT}/${out}`);
}

writeFileSync(join(OUT, 'index.html'), `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=Main.html"><title>Adaptive Platform Monitor</title></head>
<body style="background:#0E1116;color:#E6EAF0;font-family:sans-serif"><a href="Main.html" style="color:#8AB8FF">대시보드로 이동</a></body></html>
`);
writeFileSync(join(OUT, '.nojekyll'), '');
console.log(`${files.length}개 페이지 빌드 완료`);
