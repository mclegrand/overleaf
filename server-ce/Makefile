# Makefile

MONOREPO_ROOT := ../
export MONOREPO_REVISION := $(shell git rev-parse HEAD)
export BRANCH_NAME ?= $(shell git rev-parse --abbrev-ref HEAD)

REPO_PREFIX := ipp

export OVERLEAF_BASE_BRANCH ?= $(REPO_PREFIX)/sharelatex-base:$(BRANCH_NAME)
export OVERLEAF_BASE_LATEST ?= $(REPO_PREFIX)/sharelatex-base
export OVERLEAF_BASE_TAG ?= $(REPO_PREFIX)/sharelatex-base:$(BRANCH_NAME)-$(MONOREPO_REVISION)
export OVERLEAF_BRANCH ?= $(REPO_PREFIX)/sharelatex:$(BRANCH_NAME)
export OVERLEAF_LATEST ?= $(REPO_PREFIX)/sharelatex
export OVERLEAF_TAG ?= $(REPO_PREFIX)/sharelatex:$(BRANCH_NAME)-$(MONOREPO_REVISION)

all: build-base build-community

build-base:
	cp .dockerignore $(MONOREPO_ROOT)
	docker build \
	  --build-arg BUILDKIT_INLINE_CACHE=1 \
	  --progress=plain \
	  --file Dockerfile-base \
	  --pull \
	  --cache-from $(OVERLEAF_BASE_LATEST) \
	  --cache-from $(OVERLEAF_BASE_BRANCH) \
	  --tag $(OVERLEAF_BASE_TAG) \
	  --tag $(OVERLEAF_BASE_BRANCH) \
	  $(MONOREPO_ROOT)


build-community:
	cp .dockerignore $(MONOREPO_ROOT)
	docker build \
	  --build-arg BUILDKIT_INLINE_CACHE=1 \
	  --progress=plain \
	  --build-arg OVERLEAF_BASE_TAG \
	  --build-arg MONOREPO_REVISION \
	  --cache-from $(OVERLEAF_LATEST) \
	  --cache-from $(OVERLEAF_BRANCH) \
	  --file Dockerfile \
	  --tag $(OVERLEAF_TAG) \
	  --tag $(OVERLEAF_BRANCH) \
	  $(MONOREPO_ROOT)


.PHONY: all build-base build-community
