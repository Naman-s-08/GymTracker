const mysql = require('mysql2');

const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'naman@123',
    database: 'GymTrackerDB'
});

db.connect(err => {
    if (err) { console.error(err); process.exit(1); }

    db.query("SHOW TABLES", (err, tables) => {
        if (err) throw err;
        console.log("TABLES:", tables);

        let count = 0;
        const describeTable = (tableName) => {
            db.query(`DESCRIBE ${tableName}`, (err, desc) => {
                if (err) throw err;
                console.log(`\n--- SCHEMA FOR ${tableName} ---`);
                console.log(desc);
                count++;
                if (count === tables.length) process.exit(0);
            });
        };

        if (tables.length === 0) process.exit(0);
        tables.forEach(row => {
            const tableName = Object.values(row)[0];
            describeTable(tableName);
        });
    });
});
