from fastapi import FastAPI

app = FastAPI()


@app.get("/")
def home():
    return {
        "message": "OpenUI Backend is working"
    }