FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    g++ make \
    libcurl4-openssl-dev \
    postgresql-server-dev-all \
    libhiredis-dev \
    libgumbo-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .
RUN g++ -std=c++20 -O2 -o crawler crawler.cpp \
    -I/usr/include/postgresql \
    -lcurl -lpq -lhiredis -lgumbo

CMD ["./crawler"]
