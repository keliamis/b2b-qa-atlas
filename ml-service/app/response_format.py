"""Normalize representation only; never invent missing steps or expected results."""
import json
import re

def decode(raw):
    raw=raw.strip()
    match=re.fullmatch(r'```(?:json)?\s*\n(.*?)\n```',raw,re.S|re.I)
    if match:raw=match.group(1)
    value=json.loads(raw)
    if isinstance(value,str):value=json.loads(value)
    return value

def normalize(raw,payload=None):
    value=decode(raw)
    if isinstance(value,list):value={'cases':value}
    if not isinstance(value,dict):raise ValueError('JSON должен содержать объект cases')
    if 'cases' not in value and 'test_cases' in value:value['cases']=value.pop('test_cases')
    value.setdefault('questions',[])
    for case in value.get('cases',[]):
        if not isinstance(case,dict):continue
        if 'gherkin' not in case and isinstance(case.get('scenario'),str):case['gherkin']=case.pop('scenario')
        if isinstance(case.get('gherkin'),str):
            text=case['gherkin'].replace('\\n','\n') if '\n' not in case['gherkin'] else case['gherkin']
            case['gherkin']=re.sub(r'```(?:gherkin)?\s*\n?|```','',text).strip()
        case.setdefault('assumptions',[])
        if payload is not None:
            case.setdefault('code','')
            if len(payload.get('requirements',[]))==1:case.setdefault('requirementIds',[payload['requirements'][0]['id']])
            case.setdefault('type','positive');case.setdefault('priority','medium')
    return value
