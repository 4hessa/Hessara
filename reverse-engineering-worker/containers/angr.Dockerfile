ARG PYTHON_BASE
FROM ${PYTHON_BASE}
ARG ANGR_VERSION
RUN test -n "$ANGR_VERSION" && pip install --no-cache-dir "angr==$ANGR_VERSION" \
    && mkdir -p /opt/hessara /input /work
COPY common.py engine.py /opt/hessara/
ENV HESSARA_ENGINE=angr HOME=/work PYTHONDONTWRITEBYTECODE=1
USER 10001:10001
WORKDIR /work
ENTRYPOINT ["python3", "/opt/hessara/engine.py"]
