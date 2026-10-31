from pathlib import Path
from urllib.parse import urlparse
import secrets,sys,os
path=Path('.env')
if path.exists():
    sys.exit('.env уже существует. Настройки сохранены; отредактируйте файл вручную.')
origin=sys.argv[1] if len(sys.argv)>1 else 'http://localhost:8080'
p=urlparse(origin)
if p.scheme not in ('http','https') or not p.hostname or p.username or p.password or p.path or p.query or p.fragment or any(c.isspace() for c in origin):
    sys.exit('Укажите адрес без пути и завершающего /: https://qa.example.ru')
if p.scheme=='http' and p.hostname not in ('localhost','127.0.0.1'):
    sys.exit('Для внешнего сервера нужен https://. Для проверки без домена используйте http://localhost:8080 и SSH-туннель.')
content=f'PUBLIC_ORIGIN={origin}\nDOMAIN={p.hostname}\nML_TOKEN={secrets.token_hex(32)}\nOPENAI_API_KEY=\nOPENAI_MODEL=\n'
fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:f.write(content)
print('Создан .env. Секрет сгенерирован; ИИ можно подключить позже.')
