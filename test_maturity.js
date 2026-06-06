const jwt = require('jsonwebtoken');

async function test() {
    const token = jwt.sign({ tid: '8b41364f-581a-4e43-b7cb-13138dac5517' }, 'secret', { noTimestamp: true });
    const res = await fetch('http://localhost:3000/api/intelligence/maturity?tenantId=8b41364f-581a-4e43-b7cb-13138dac5517', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    console.log(data);
}
test();
