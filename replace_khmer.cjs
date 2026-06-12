const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

const khmerNumbersMap = {
  '០': '0',
  '១': '1',
  '២': '2',
  '៣': '3',
  '៤': '4',
  '៥': '5',
  '៦': '6',
  '៧': '7',
  '៨': '8',
  '៩': '9'
};

content = content.replace(/[០-៩]/g, (match) => khmerNumbersMap[match]);

fs.writeFileSync('src/App.tsx', content);
console.log('Done replacing Khmer numbers.');
