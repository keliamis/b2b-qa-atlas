FROM python:3.12-slim
WORKDIR /service
RUN pip install --no-cache-dir fastapi==0.115.12 uvicorn==0.34.3 docker==7.1.0
COPY runner/service.py .
CMD ["uvicorn", "service:app", "--host", "0.0.0.0", "--port", "8001"]
