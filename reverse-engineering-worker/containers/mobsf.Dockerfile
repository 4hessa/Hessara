# Must be an audited official opensecurity/mobile-security-framework-mobsf
# image referenced by digest, never latest. No ports are published by supervisor.
ARG MOBSF_BASE
FROM ${MOBSF_BASE}
USER root
COPY common.py engine.py /opt/hessara/
RUN mkdir -p /input /work && chmod 755 /input /opt/hessara
ENV HESSARA_ENGINE=mobsf HOME=/work MOBSF_API_ONLY=1 MOBSF_DOMAIN_MALWARE_SCAN=0
USER 10001:10001
WORKDIR /work
ENTRYPOINT ["python3", "/opt/hessara/engine.py"]
