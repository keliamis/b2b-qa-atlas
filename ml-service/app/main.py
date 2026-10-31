import os,hmac,base64,logging
from fastapi import FastAPI,Depends,Header,HTTPException
from pydantic import BaseModel,Field
from .generator import generate
from .documents import extract, requirements_from_text
logger=logging.getLogger(__name__)
app=FastAPI(title='QA Atlas processing service',version='0.8.3')

def auth(authorization:str=Header(default='')):
    token=os.getenv('ML_TOKEN','')
    if not token or not hmac.compare_digest(authorization,'Bearer '+token):
        raise HTTPException(401,'Нет доступа к сервису обработки')

@app.get('/health')
def health():
    return {'status':'ok'}

class DocumentInput(BaseModel):
    name:str=Field(max_length=260)
    data:str=Field(max_length=14_000_000)

@app.post('/parse',dependencies=[Depends(auth)])
def parse(data:DocumentInput):
    try:
        raw=base64.b64decode(data.data,validate=True)
        if len(raw)>10*1024*1024:
            raise ValueError('Лимит файла — 10 МБ')
        text = extract(data.name,raw)
        if data.name.lower().endswith(('.pdf','.docx','.md','.txt')):
            return {'requirements': requirements_from_text(text), 'characters': len(text),
                    **({'text': text} if len(text) <= 120000 else {})}
        return {'text': text}
    except ValueError as e:
        raise HTTPException(400,str(e))
    except Exception:
        raise HTTPException(400,'Не удалось прочитать документ. Проверьте формат файла')

@app.post('/generate',dependencies=[Depends(auth)])
def generation(data:dict):
    try:
        return generate(data)
    except ValueError as e:
        raise HTTPException(400,str(e))
    except Exception:
        raise HTTPException(502,'Провайдер генерации недоступен или вернул некорректный ответ')


class InsightInput(BaseModel):
    kind: str = Field(pattern='^(detective|constraints|scenario)$')
    payload: str = Field(max_length=60000)

@app.post('/insights',dependencies=[Depends(auth)])
def insights(data:InsightInput):
    from .insights import analyze
    try:
        return analyze(data.kind,data.payload)
    except ValueError as exc:
        raise HTTPException(502,'Не удалось проверить ответ ИИ: '+str(exc)[:300])
    except Exception as exc:
        logger.exception('Insight processing failed: kind=%s exception=%s',data.kind,type(exc).__name__)
        raise HTTPException(502,'ИИ недоступен или вернул некорректный ответ. Проверьте настройки и повторите запрос.') from exc
