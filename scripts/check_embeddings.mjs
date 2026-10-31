// Live provider smoke check; no database writes. Uses real API quota.
import {embeddingConfig,embedTexts} from '../backend/src/vectors.mjs';
try{
 const config=embeddingConfig();
 const [login,unrelated]=await embedTexts(['Пользователь входит в аккаунт с помощью логина и пароля.','Товар добавляется в корзину интернет-магазина.'],config);
 const [query]=await embedTexts(['Авторизация пользователя'],config,{query:true});
 const cosine=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0)/(Math.hypot(...a)*Math.hypot(...b));
 if(login.length!==query.length||unrelated.length!==query.length)throw new Error('Размерности моделей не совпадают');
 const related=cosine(query,login),other=cosine(query,unrelated);
 console.log(JSON.stringify({model:config.documentModel,queryModel:config.queryModel,dimensions:query.length,relatedSimilarity:related,unrelatedSimilarity:other,smokePassed:related>other},null,2));
 if(!(related>other))process.exitCode=1;
}catch(e){console.error(e.message);process.exitCode=1;}
