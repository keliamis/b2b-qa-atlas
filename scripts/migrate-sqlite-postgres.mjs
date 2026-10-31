import {DatabaseSync} from 'node:sqlite';
import {openDatabase} from '../backend/src/database.mjs';
if(!process.env.DATABASE_URL||!process.argv[2])throw new Error('DATABASE_URL and read-only SQLite source path required');
const source=new DatabaseSync(process.argv[2],{readOnly:true}),dest=openDatabase();
try{
 if(Number(dest.raw.prepare('SELECT count(*) AS n FROM accounts').get().n)||Number(dest.raw.prepare('SELECT count(*) AS n FROM projects').get().n))throw new Error('Target must be empty; existing data will not be overwritten');
 const tables=source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'schema_migrations'").all().map(x=>x.name);
 const order=['accounts','profiles','projects','members','sessions','login_attempts','account_tokens','comments','invitations','manual_runs','defects','saved_views','jobs','ai_feature_records'];
 dest.raw.exec('BEGIN');
 try{for(const table of order.filter(t=>tables.includes(t))){for(const row of source.prepare(`SELECT * FROM "${table}"`).all()){
 const fields=Object.keys(row);dest.raw.prepare(`INSERT INTO "${table}" (${fields.map(f=>'"'+f+'"').join(',')}) VALUES(${fields.map(()=>'?').join(',')})`).run(...Object.values(row));
 }}dest.raw.exec('COMMIT');}catch(e){dest.raw.exec('ROLLBACK');throw e;}
 console.log('Migration committed; source unchanged');
}finally{source.close();dest.close();}
