ARG JAVA_BASE
FROM ${JAVA_BASE}
ARG JADX_VERSION
ARG JADX_SHA256
RUN test -n "$JADX_VERSION" && test "${#JADX_SHA256}" = 64 \
    && apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates curl unzip && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL "https://github.com/skylot/jadx/releases/download/v${JADX_VERSION}/jadx-${JADX_VERSION}.zip" -o /tmp/jadx.zip \
    && printf '%s  %s\n' "$JADX_SHA256" /tmp/jadx.zip | sha256sum -c - \
    && unzip -q /tmp/jadx.zip -d /opt/jadx && rm /tmp/jadx.zip && chmod +x /opt/jadx/bin/jadx \
    && mkdir -p /opt/hessara /input /work
COPY common.py engine.py /opt/hessara/
ENV HESSARA_ENGINE=jadx HOME=/work PATH=/opt/jadx/bin:$PATH JAVA_OPTS=-Xmx1024m
USER 10001:10001
WORKDIR /work
ENTRYPOINT ["python3", "/opt/hessara/engine.py"]
