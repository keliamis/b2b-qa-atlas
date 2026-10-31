import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({root:'frontend',plugins:[react()],server:{host:'127.0.0.1',port:5173,strictPort:true,proxy:{'/workspace-api':'http://127.0.0.1:8080','/api':'http://127.0.0.1:8080','/auth':'http://127.0.0.1:8080'}}});
