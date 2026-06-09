const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'node_modules', '@azure', 'arm-consumption', 'src', 'models', 'index.ts');
if(fs.existsSync(file)) {
    console.log(fs.readFileSync(file, 'utf8'));
} else {
    const file2 = path.join(__dirname, '..', 'node_modules', '@azure', 'arm-consumption', 'types', 'arm-consumption.d.ts');
    if(fs.existsSync(file2)) {
        console.log(fs.readFileSync(file2, 'utf8'));
    } else {
        console.log("Could not find definition file");
    }
}
