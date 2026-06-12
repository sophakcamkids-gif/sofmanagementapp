const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');
content = content.replace(/\{row\.id\}/g, "{typeof row.id === 'string' ? row.id.split(' ').pop() : row.id}");
fs.writeFileSync('src/App.tsx', content);
console.log('done replacing row ids');
