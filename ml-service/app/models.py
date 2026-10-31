from pydantic import BaseModel, ConfigDict, Field
from typing import Annotated, Literal

Text = Annotated[str, Field(max_length=2000)]

class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)

class Artifacts(Strict):
    pytest: str = Field(default='', max_length=100000)
    playwright: str = Field(default='', max_length=100000)

class Draft(Strict):
    title: str = Field(min_length=1, max_length=500)
    requirementIds: list[Annotated[str, Field(min_length=1, max_length=100)]] = Field(min_length=1, max_length=1000)
    type: Literal['positive', 'negative', 'boundary']
    priority: Literal['critical', 'high', 'medium', 'low']
    gherkin: str = Field(max_length=50000)
    code: str = Field(max_length=100000)
    artifacts: Artifacts | None = None
    assumptions: list[Text] = Field(max_length=100)

class Generation(Strict):
    cases: list[Draft] = Field(max_length=15)
    questions: list[Text] = Field(max_length=100)
