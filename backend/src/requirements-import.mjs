/** Import source requirements without conflating text chunks with business rules.
 * Extracts identifiers from headings when available, retains page references for PDFs,
 * and falls back to page-aware text chunks for documents without explicit headings.
 */
const HEADER = /^\s*(REQ[-_ ]?\d{1,6})\s*[—–:\-]\s*(.+?)\s*$/gim;
const PAGE = /^\[Страница\s+(\d+)\]\s*$/gim;
const clean = value => value.replace(/\r/g, '').trim();

export function extractedRequirements(text, name, usedKeys = []) {
  const source = clean(text);
  if (!source) return [];
  const pages = [...source.matchAll(PAGE)].map(m => ({index:m.index, page:Number(m[1])}));
  const pageFor = index => {
    let page = null;
    for (const p of pages) {if (p.index > index) break; page = p.page;}
    return page;
  };
  const headers = [...source.matchAll(HEADER)].filter(m => m[2].trim().length > 0);
  const selected = [];
  if (headers.length) {
    for (let i=0; i<headers.length; i++) {
      const h = headers[i];
      let end = i+1 < headers.length ? headers[i+1].index : source.length;
      // The page header of the following requirement must not be included in this rule.
      const followingPage = pages.find(p => p.index > h.index && p.index < end);
      if (followingPage) end = followingPage.index;
      const key = h[1].toUpperCase().replace(/[_ ]/g,'-');
      const title = clean(h[2]);
      const body = clean(source.slice(h.index,end));
      selected.push({key, title, text:body, page:pageFor(h.index)});
    }
    // If the document also contains substantial unstructured text before the first
    // requirement, keep it visible rather than silently discarding it.
    const preamble = source.slice(0, headers[0].index).replace(PAGE,'').trim();
    if (preamble.length > 600) selected.unshift({key:null,title:'Вводная часть документа',text:preamble,page:pages[0]?.page||null});
  } else if (pages.length) {
    for (let i=0; i<pages.length; i++) {
      const p=pages[i], end=pages[i+1]?.index ?? source.length;
      const body=clean(source.slice(p.index,end));
      if (body) selected.push({key:null,title:`Страница ${p.page}`,text:body,page:p.page});
    }
  } else {
    let rest=source, n=0;
    while(rest.length) {
      let cut=rest.length<=6000?rest.length:rest.lastIndexOf('\n',6000);
      if(cut<3000 && rest.length>6000)cut=6000;
      const part=clean(rest.slice(0,cut));rest=clean(rest.slice(cut));
      if(part)selected.push({key:null,title:`Фрагмент ${++n}`,text:part,page:null});
    }
  }
  const occupied = new Set(usedKeys.map(x=>x.toUpperCase()));
  let next = Math.max(0,...[...occupied].map(k=>Number(k.match(/^REQ-(\d+)$/)?.[1])||0));
  const newKey = () => {let k;do{k=`REQ-${String(++next).padStart(3,'0')}`;}while(occupied.has(k));return k;};
  return selected.map(item=>{
    const key = item.key && !occupied.has(item.key) ? item.key : newKey();
    occupied.add(key);
    return {key, title:item.key && item.key!==key ? `${item.key} — ${item.title}`:item.title,
      text:item.page === null ? item.text : `[Страница ${item.page}]\n${item.text}`, priority:'medium', source:name};
  });
}
