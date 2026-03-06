FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    g++ make curl \
    postgresql-server-dev-all \
    libhiredis-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .
RUN g++ -std=c++20 -O2 -o api_server api_server.cpp \
    -I/usr/include/postgresql \
    -lpq -lhiredis -lpthread

EXPOSE 8080
CMD ["./api_server"]
