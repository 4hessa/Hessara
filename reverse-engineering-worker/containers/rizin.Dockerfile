ARG PYTHON_BASE
FROM ${PYTHON_BASE} AS build
ARG SOURCE_COMMIT
RUN echo "$SOURCE_COMMIT" | grep -Eq '^[a-f0-9]{40}$' \
    && apt-get update && apt-get install -y --no-install-recommends git build-essential pkg-config meson ninja-build cmake \
    && git init /src && cd /src && git remote add origin https://github.com/rizinorg/rizin.git \
    && git fetch --depth=1 origin "$SOURCE_COMMIT" && git checkout --detach FETCH_HEAD \
    && meson setup build --prefix=/opt/rizin && meson compile -C build && meson install -C build
FROM ${PYTHON_BASE}
COPY --from=build /opt/rizin /opt/rizin
COPY --from=build /src/COPYING* /usr/share/doc/hessara-rizin/
COPY common.py engine.py /opt/hessara/
RUN mkdir -p /input /work
ENV HESSARA_ENGINE=rizin HOME=/work PATH=/opt/rizin/bin:$PATH LD_LIBRARY_PATH=/opt/rizin/lib:/opt/rizin/lib/x86_64-linux-gnu
USER 10001:10001
WORKDIR /work
ENTRYPOINT ["python3", "/opt/hessara/engine.py"]
