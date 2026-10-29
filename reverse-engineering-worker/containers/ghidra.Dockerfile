ARG JAVA_BASE
FROM ${JAVA_BASE}
ARG GHIDRA_RELEASE_TAG
ARG GHIDRA_ARCHIVE
ARG GHIDRA_SHA256
RUN test -n "$GHIDRA_RELEASE_TAG" && test -n "$GHIDRA_ARCHIVE" && test "${#GHIDRA_SHA256}" = 64 \
    && apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates curl unzip && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL "https://github.com/NationalSecurityAgency/ghidra/releases/download/${GHIDRA_RELEASE_TAG}/${GHIDRA_ARCHIVE}" -o /tmp/ghidra.zip \
    && printf '%s  %s\n' "$GHIDRA_SHA256" /tmp/ghidra.zip | sha256sum -c - \
    && mkdir /opt/unpacked && unzip -q /tmp/ghidra.zip -d /opt/unpacked \
    && mv /opt/unpacked/ghidra_* /opt/ghidra && rm -r /tmp/ghidra.zip /opt/unpacked \
    && mkdir -p /opt/hessara /input /work
COPY common.py engine.py /opt/hessara/
COPY ghidra/ /opt/hessara/ghidra/
ENV HESSARA_ENGINE=ghidra HOME=/work MAXMEM=1536M
USER 10001:10001
WORKDIR /work
ENTRYPOINT ["python3", "/opt/hessara/engine.py"]
