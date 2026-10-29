ARG NODE_BASE
FROM ${NODE_BASE}
ARG REA_VERSION
RUN test -n "$REA_VERSION" && apt-get update && apt-get install -y --no-install-recommends python3 procps ca-certificates && rm -rf /var/lib/apt/lists/* \
    && npm install --global --ignore-scripts rea-agents@"$REA_VERSION" \
    && mkdir -p /opt/hessara /input /work && chmod 755 /input
COPY common.py engine.py /opt/hessara/
ENV HESSARA_ENGINE=rea HOME=/work NODE_OPTIONS=--max-old-space-size=640
USER 10001:10001
WORKDIR /work
ENTRYPOINT ["python3", "/opt/hessara/engine.py"]
