ARG PYTHON_BASE
FROM ${PYTHON_BASE} AS build
ARG SOURCE_COMMIT
RUN echo "$SOURCE_COMMIT" | grep -Eq '^[a-f0-9]{40}$' \
    && apt-get update && apt-get install -y --no-install-recommends git build-essential pkg-config \
    && git init /src && cd /src && git remote add origin https://github.com/radareorg/radare2.git \
    && git fetch --depth=1 origin "$SOURCE_COMMIT" && git checkout --detach FETCH_HEAD \
    && ./configure --prefix=/opt/radare2 && make -j2 && make install
FROM ${PYTHON_BASE}
COPY --from=build /opt/radare2 /opt/radare2
COPY --from=build /src/COPYING* /usr/share/doc/hessara-radare2/
COPY common.py engine.py /opt/hessara/
RUN mkdir -p /input /work
ENV HESSARA_ENGINE=radare2 HOME=/work PATH=/opt/radare2/bin:$PATH LD_LIBRARY_PATH=/opt/radare2/lib
USER 10001:10001
WORKDIR /work
ENTRYPOINT ["python3", "/opt/hessara/engine.py"]
