const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');
content = content.replace(/<td className="px-3 py-2 border-r border-slate-300 text-center text-slate-500 font-medium">\{row\.id\}<\/td>/g, '<td className="px-3 py-2 border-r border-slate-300 text-center text-slate-500 font-medium">{typeof row.id === \\'string\\' ? row.id.split(\\' \\').pop() : row.id}</td>');
fs.writeFileSync('src/App.tsx', content);
console.log('done replacing row ids');
